# Publisher Signing Key Rotation Runbook

This runbook covers both **scheduled rotation** and **emergency revocation** of the
reputation publisher's signing key (`PUBLISHER_SECRET`). It includes a testnet
rehearsal procedure with timing estimates.

## Prerequisites

- Stellar CLI installed (`stellar --version`)
- Node.js 20+ installed (`node --version`)
- Repository is up to date (`git pull`)
- Access to the current `PUBLISHER_SECRET` environment file or Vault
- Admin key access for the reputation-verifier contract

## Scheduled Rotation

Perform during a maintenance window when no critical root publications are pending.

### Step 1 — Generate a new keypair

```bash
stellar keys generate opaque-publisher-new --network testnet --fund
stellar keys address opaque-publisher-new   # confirm the G-address
```

### Step 2 — Fund the new account

```bash
curl "https://friendbot.stellar.org?addr=<new-G-address>"
```

Or if using named identities:

```bash
stellar keys fund opaque-publisher-new --network testnet
```

### Step 3 — Grant the new key publisher permission

The reputation-verifier contract must authorize the new key to call
`update_merkle_root`. The exact mechanism depends on the contract version:

- **Current testnet** (admin-only): The new key must become the contract admin.
  Transfer admin ownership to the new key via the contract admin interface.
- **Future root-publisher role**: Call `grant_root_publisher(new_pubkey)` from the
  contract admin.

### Step 4 — Update the environment

Update the `PUBLISHER_SECRET` in your environment file or Vault:

```bash
# File-based:
nano ~/.opaque-reputation-publisher.env
# Set PUBLISHER_SECRET=S...new-secret...

# Vault-based:
vault kv put secret/opaque/publisher PUBLISHER_SECRET="S...new-secret..."
```

### Step 5 — Restart the publisher

```bash
sudo systemctl stop opaque-publisher
sudo systemctl start opaque-publisher
```

### Step 6 — Confirm successful publication

Watch the logs for a successful publish:

```bash
sudo journalctl -u opaque-publisher -f
```

Look for:

```text
PUBLISHED <txHash>
```

If you see `Unauthorized`, the new key does not have publisher permission on the
contract. Go back to Step 3.

### Step 7 — Revoke the old key

Once the new key is confirmed publishing, revoke the old key's permission on the
contract. If the old key was the admin, transfer admin to a separate long-lived
admin account.

### Step 8 — Decommission the old account

Optionally drain remaining XLM from the old account to a safe destination:

```bash
stellar keys generate drain-target --network testnet
stellar tx invoke \
  --source-account opaque-publisher-old \
  --to <drain-target-G-address> \
  --amount 1 \
  --network testnet
```

## Emergency Revocation (Compromise Response)

If the publisher signing key is suspected compromised, follow these steps
**immediately**. The compromised key can only publish roots — it cannot forge proofs
or bypass nullifier checks — but a malicious root could break reputation verification
for wallets.

### Step 1 — Stop the publisher

```bash
sudo systemctl stop opaque-publisher
```

### Step 2 — Revoke the compromised key on-chain

Using the contract admin key:

```bash
# Current testnet: transfer admin to a new safe key
stellar contract invoke \
  --id <reputation-verifier-id> \
  --source-account <admin-secret> \
  -- \
  set_admin \
  --new_admin <new-safe-admin-pubkey>
```

Or if using a root-publisher role:

```bash
stellar contract invoke \
  --id <reputation-verifier-id> \
  --source-account <admin-secret> \
  -- \
  revoke_root_publisher \
  --publisher <compromised-pubkey>
```

### Step 3 — Audit on-chain activity

Check the compromised key's recent transactions on
[stellar.expert](https://stellar.expert/explorer/testnet):

```text
https://stellar.expert/explorer/testnet/account/<compromised-G-address>
```

Look for any unauthorized `update_merkle_root` calls.

### Step 4 — Generate and configure a new key

Follow Steps 1–4 from the scheduled rotation procedure above with a fresh keypair.

### Step 5 — Restart the publisher

```bash
sudo systemctl start opaque-publisher
```

Confirm healthy operation via logs.

## Downstream Verifier Trust Update Path

The reputation-verifier contract is the single source of truth for published roots.
Wallets and scanners that verify reputation proofs read the root from the contract
state directly. There is **no key-level trust chain in the verifier** — the contract
trusts whoever has admin or root-publisher permission, and that trust is managed
on-chain.

### What downstream verifiers need to do

- **Nothing** during a key rotation. The contract root is key-agnostic. Wallets read
  `get_latest_root()` and verify Merkle inclusion against it. The signing key used to
  publish that root is not part of the proof verification.
- **If contract admin changes**: Wallets and scanners are not affected — they interact
  with the contract, not the admin key.
- **If the verifier contract itself is redeployed**: Update the contract ID in the SDK
  config and redeploy any dependent services.

### Exception: cached root with stale publisher

If a wallet caches a root and the publisher publishes a new root with the same key
(or a new key), the wallet simply re-fetches `get_latest_root()` on the next
verification. No trust store update is needed.

## Testnet Rehearsal Procedure

Rehearse the full rotation on testnet to validate timing and catch issues before
production.

### Prerequisites

- Fresh testnet deployment (see `docs/testnet-reset-runbook.md`)
- Current publisher running with existing `PUBLISHER_SECRET`

### Rehearsal Steps

| Step | Action | Expected Time |
|:--|:--|:--|
| 1 | Deploy fresh contracts | ~12 min |
| 2 | Start publisher, confirm publish | ~2 min |
| 3 | Generate new keypair | ~1 min |
| 4 | Fund new account | ~1 min |
| 5 | Grant publisher permission | ~2 min |
| 6 | Update env and restart | ~1 min |
| 7 | Confirm new key publishes | ~2 min |
| 8 | Revoke old key | ~1 min |
| 9 | Verify old key is rejected | ~1 min |
| 10 | End-to-end verification | ~3 min |
| **Total** | | **~26 min** |

### Rehearsal Checklist

- [ ] New keypair generated and funded
- [ ] Publisher permission granted on-chain
- [ ] Publisher restarted with new key
- [ ] `PUBLISHED <txHash>` confirmed in logs
- [ ] Old key revoked on-chain
- [ ] Old key returns `Unauthorized` when attempting to publish
- [ ] Wallet can still verify reputation proofs against the published root
- [ ] No errors in publisher logs after rotation

### Timing Notes

- Contract deployment is the longest step (~12 min). After that, the actual
  rotation procedure takes ~14 minutes.
- The gap between revoking the old key and confirming the new key is publishing
  should be minimized. Prepare the new key and permission grant before stopping the
  old publisher.
- If the publisher runs in loop mode (`npm run publisher`), the restart window is
  typically 10–30 seconds depending on the systemd restart delay.

## Troubleshooting

| Symptom | Likely cause | Fix |
|:--|:--|:--|
| `Unauthorized` after rotation | New key not granted permission | Re-run Step 3 (grant permission) |
| Publisher logs show no publish | New root matches on-chain root | Verify contract state has an old root; force publish by adding a test leaf |
| `fee too low` on grant tx | Testnet congestion | Increase fee or retry after a few seconds |
| Old key still publishing | Old publisher process not stopped | `sudo systemctl stop opaque-publisher` on the old host |
