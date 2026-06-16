# @opaquecash/reputation-publisher

The reputation publisher is the off-chain service that keeps the PSR
`reputation-verifier` usable. It accepts holder-submitted V2 leaf commitments, builds the
deterministic Poseidon Merkle tree, and publishes the latest root to Soroban with
`update_merkle_root`.

The browser cannot complete `Submit On-Chain` until the proof's Merkle root is present in
the verifier contract. This service is the missing liveness piece.

## Why This Exists

The V2 reputation circuit proves inclusion of a leaf:

```text
Poseidon(stealth_pk, schema_id, issuer_pk_x, trait_data_hash, nonce)
```

Two of those values, `stealth_pk` and `trait_data_hash`, are private holder-side data.
A passive indexer that only listens to public attestation announcements cannot derive the
leaf. That is intentional: otherwise reputation leaves could be enumerated.

So the publisher's input is not "all public attestations." Its input is the set of leaf
commitments that holders or wallet clients choose to submit:

```text
holder wallet -> computes leaf locally -> submits leaf commitment -> publisher -> root
```

The publisher never receives the stealth private key, decoded trait data, or proof witness.

## How It Works Now

This workspace ships a file-backed MVP:

1. Holder/client writes leaf JSON into `publisher/data/inbox/`.
2. The publisher loop reads the inbox and normalizes each 32-byte leaf commitment.
3. It deduplicates by id and leaf.
4. It rebuilds a depth-20 Poseidon(2) Merkle tree from the ordered leaf set.
5. It compares the local root with `reputation-verifier.get_latest_root`.
6. If the root differs, it writes a root manifest under `publisher/data/roots/` and sends
   `update_merkle_root(admin, root, dataset_hash)`.
7. Accepted inbox files are archived and durable state is written under
   `publisher/data/state/`.

The current testnet contract allows only the verifier admin to publish roots, so the MVP
uses `PUBLISHER_SECRET` with the admin/deployer key. This is acceptable for testnet and
local demos only.

## Production Shape

In production, this should become a dedicated root-publisher service:

- Replace the file inbox with an authenticated HTTPS endpoint or queue.
- Add a dedicated `root_publisher` role in the contract instead of using the admin key.
- Store commitments and cursors in Postgres or another durable database.
- Backfill from a durable event/source log on restart.
- Publish before the current root expiry window elapses, even if no new leaves arrived.
- Expose an API for wallets to fetch the current root and Merkle path for their leaf.
- Monitor ingestion lag, publish failures, root age, and signer balance.
- Run the signer with minimal privileges and key isolation.

The production service can still listen to public attestation announcements, but those
events are only context for validation and observability. They are not enough to build the
private V2 leaf.

## Install

```bash
cd publisher
npm ci
```

## Configure

Create an environment file outside git:

```bash
nano ~/.opaque-reputation-publisher.env
chmod 600 ~/.opaque-reputation-publisher.env
```

Example:

```bash
PUBLISHER_SECRET=S...current_testnet_admin_secret...
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
PUBLISHER_INTERVAL_MS=15000
PUBLISHER_DATA_DIR=/var/lib/opaque-reputation-publisher
```

Variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLISHER_SECRET` | required | Signer allowed to call `update_merkle_root`. On current testnet this is the verifier admin. |
| `DEPLOYER_SECRET` | fallback | Accepted only as a local/testnet convenience when `PUBLISHER_SECRET` is unset. |
| `REPUTATION_VERIFIER_ID` | manifest value | Override verifier contract id. |
| `STELLAR_RPC_URL` | manifest RPC | Soroban RPC endpoint. |
| `PUBLISHER_INTERVAL_MS` | `15000` | Loop interval for continuous publishing. |
| `PUBLISHER_DATA_DIR` | `publisher/data` | Durable inbox/state/root manifest directory. |

## Submit A Leaf Locally

For local/demo use, write a leaf into the inbox:

```bash
cd publisher
npm run submit:leaf -- \
  --id demo-leaf-1 \
  --leaf 0x0000000000000000000000000000000000000000000000000000000000000001
```

The real wallet should submit the actual V2 leaf commitment it computed from the holder's
private attestation material. The publisher only checks shape and dedupe; it cannot prove
the leaf is semantically valid until a user later proves inclusion with the Groth16 proof.

## Run One Tick

```bash
cd publisher
set -a
source ~/.opaque-reputation-publisher.env
set +a
npm run publisher:once
```

Healthy output:

```text
leaves=1 (+1) root=0x1234abcd... PUBLISHED <txHash>
```

If the on-chain root already matches:

```text
leaves=1 (+0) root=0x1234abcd... in-sync
```

## Run Continuously

```bash
cd publisher
set -a
source ~/.opaque-reputation-publisher.env
set +a
npm run publisher
```

## systemd Example

```ini
[Unit]
Description=Opaque reputation root publisher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opaque
WorkingDirectory=/srv/opaque/stellar/publisher
EnvironmentFile=/home/opaque/.opaque-reputation-publisher.env
ExecStart=/usr/bin/npm run publisher
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Data Files

```text
publisher/data/inbox/*.json             pending holder-submitted leaves
publisher/data/archive/*.json           accepted inbox files
publisher/data/state/<verifier>.json    durable leaf set and last published root
publisher/data/roots/<verifier>/*.json  published root manifests
```

Inbox item shape:

```json
{
  "id": "attestation-uid-or-client-generated-id",
  "leaf": "0x...",
  "schemaId": "0x...",
  "attestationUid": "0x...",
  "txHash": "...",
  "ledger": 3123456
}
```

Only `id` and `leaf` are required.

## Security Notes

- Do not run the daemon with the admin key in production.
- Add a dedicated root-publisher role before mainnet usage.
- Treat the signer as a hot key and isolate it from web request handling.
- Rate-limit and authenticate holder leaf submissions.
- Keep the append-only commitment log so roots can be reconstructed and audited.
- A malicious publisher can censor leaves or publish stale roots, but it cannot forge a
  holder's Groth16 proof or bypass nullifier replay protection in the verifier.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `set PUBLISHER_SECRET` | Missing signer secret. | Export `PUBLISHER_SECRET` in the environment file. |
| Frontend says no root | No leaves have been accepted or publish transaction failed. | Add a leaf and run `npm run publisher:once`; check signer funding. |
| Frontend says root mismatch | The proof was generated against a leaf/root not in the published tree. | Submit the exact leaf commitment used by the proof, publish, then regenerate/fetch the path. |
| `Unauthorized` from Soroban | Signer is not verifier admin on current contract. | Use the current admin for testnet, or deploy a contract with a root-publisher role. |
| Repeated publishing | On-chain root read is failing or another publisher is racing. | Check RPC health and ensure only one active publisher per verifier. |
