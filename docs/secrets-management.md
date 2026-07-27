# Secrets Management Guide for Service Operators

This guide covers storage, least-privilege scoping, and zero-downtime rotation for every
secret used by the three off-chain Opaque services: the ASP indexer, the reputation
publisher, and the relayer.

## Secret inventory

| Secret | Service | What it can do | Blast radius |
|:--|:--|:--|:--|
| `ASP_SECRET` | ASP indexer | Call `update_asp_root` and `update_state_root` on the privacy-pool contract | Publish a bad root; cannot move user funds — the pool custody invariant still holds |
| `PUBLISHER_SECRET` | Reputation publisher | Call `update_merkle_root` on the reputation-verifier contract | Publish a stale or empty root; cannot forge Groth16 proofs or bypass nullifier replay |
| `RELAYER_OPERATOR_SECRET` | Relayer | Submit privacy-pool withdrawals, stake/unstake XLM in the relayer registry | Lose staked XLM if misused; cannot redirect withdrawal recipient or amount (proof-bound) |
| `RELAYER_X25519_SECRET` | Relayer | Decrypt withdrawal payloads from wallets | Decrypt in-flight jobs; cannot alter the proof or redirect funds |

None of these secrets can move funds out of the privacy pool arbitrarily. The Groth16
proof, nullifier check, and custody invariant are enforced on-chain regardless of who
holds the service keys.

## Storage options

### Option A — encrypted file (minimum viable)

Suitable for a single-operator testnet setup.

```bash
# Create the file outside the repository
nano ~/.opaque-asp.env
chmod 600 ~/.opaque-asp.env

# Verify only the service user can read it
ls -la ~/.opaque-asp.env
# -rw------- 1 opaque opaque ...
```

Run each service under a dedicated Linux user (`opaque-asp`, `opaque-publisher`,
`opaque-relayer`) so the files are not readable across services:

```bash
sudo useradd --system --no-create-home opaque-asp
sudo install -o opaque-asp -g opaque-asp -m 600 /dev/null /etc/opaque/asp.env
sudo nano /etc/opaque/asp.env
```

Reference the file in the systemd unit:

```ini
[Service]
EnvironmentFile=/etc/opaque/asp.env
```

### Option B — HashiCorp Vault (recommended for production)

Store each secret as a KV v2 entry and inject it at runtime via the Vault agent or
`envconsul`.

```bash
# Write secrets
vault kv put secret/opaque/asp ASP_SECRET="S..."
vault kv put secret/opaque/publisher PUBLISHER_SECRET="S..."
vault kv put secret/opaque/relayer \
  RELAYER_OPERATOR_SECRET="S..." \
  RELAYER_X25519_SECRET="abcdef..."

# Read back to verify
vault kv get secret/opaque/asp
```

Create a narrow policy for each service — the ASP agent should only be able to read
`secret/opaque/asp`, not the relayer secret:

```hcl
# vault-policy-asp.hcl
path "secret/data/opaque/asp" {
  capabilities = ["read"]
}
```

```bash
vault policy write opaque-asp vault-policy-asp.hcl
vault token create -policy=opaque-asp -ttl=24h -renewable=true
```

Inject into the systemd unit via `envconsul`:

```ini
[Service]
ExecStart=/usr/bin/envconsul \
  -secret secret/opaque/asp \
  -vault-addr=https://vault.example.com \
  /usr/bin/npm run indexer
```

## Least-privilege scoping

Each service key should be a **dedicated Stellar account** with only the permissions it
needs. Never reuse the deployer or pool admin key for a running service.

| Service | Required on-chain permission | How to scope |
|:--|:--|:--|
| ASP | `update_asp_root`, `update_state_root` on the privacy-pool contract | Deploy with a separate ASP authority account; set it as the pool's `asp_authority` |
| Publisher | `update_merkle_root` on the reputation-verifier contract | Use a dedicated publisher account; grant it the `root_publisher` role when the contract supports it |
| Relayer | Stake in the relayer registry; submit withdrawals | Use a dedicated operator account; keep stake minimal (just above `minimumStake`) |

Fund each account with only enough XLM for transaction fees plus the required stake. Do
not hold user funds in service accounts.

## Rotation procedures (zero downtime)

### Rotating `ASP_SECRET`

1. Generate a new Stellar keypair: `stellar keys generate opaque-asp-new --network testnet --fund`
2. Grant the new key `asp_authority` on the privacy-pool contract (requires current admin).
3. Update the environment file or Vault entry with the new `ASP_SECRET`.
4. Restart the ASP service: `sudo systemctl restart opaque-asp`
5. Confirm the next tick publishes successfully (`ASP_PUBLISHED STATE_PUBLISHED` in logs).
6. Revoke the old key's `asp_authority` on-chain.
7. Decommission the old Stellar account.

### Rotating `PUBLISHER_SECRET`

1. Generate a new keypair: `stellar keys generate opaque-publisher-new --network testnet --fund`
2. Grant the new key the publisher role on the reputation-verifier contract.
3. Update the environment file or Vault entry with the new `PUBLISHER_SECRET`.
4. Restart the publisher: `sudo systemctl restart opaque-publisher`
5. Confirm the next tick publishes (`PUBLISHED <txHash>` in logs).
6. Revoke the old key's publisher role on-chain.

### Rotating `RELAYER_OPERATOR_SECRET` and `RELAYER_X25519_SECRET`

Rotating the operator key requires re-registering on-chain because the registry stores
the operator's public key and X25519 public key.

1. Generate a new operator keypair and fund it.
2. Derive a new X25519 secret from the new operator key (see [running-relayer.md](running-relayer.md#derive-x25519-secret)).
3. Stop the relayer: `sudo systemctl stop opaque-relayer`
4. Update `RELAYER_OPERATOR_SECRET` and `RELAYER_X25519_SECRET` in the environment file or Vault.
5. Run `npm run register` to register the new operator on-chain.
6. Start the relayer: `sudo systemctl start opaque-relayer`
7. Confirm healthy startup (operator address and x25519 key logged).
8. Unstake and decommission the old operator account after the cooldown period (`unstakeCooldownLedgers`).

> [!NOTE]
> The relayer rotation has a brief window where the old registration is still on-chain
> but the old key is no longer running. Wallets may see no valid bids during this window.
> Keep the window short by preparing the new registration before stopping the old process.

## Emergency response

If a secret is suspected compromised:

1. **Stop the affected service immediately**: `sudo systemctl stop opaque-<service>`
2. **Revoke on-chain permissions** for the compromised key (requires admin key).
3. **Generate a new keypair**, update the environment file or Vault, and re-register if needed.
4. **Restart the service** and confirm healthy operation.
5. **Audit recent on-chain activity** for the compromised key on [stellar.expert](https://stellar.expert/explorer/testnet).

For `RELAYER_X25519_SECRET` compromise: any in-flight jobs encrypted to the old key may
have been decrypted. The proof and recipient are still bound by the Groth16 proof, so
funds cannot be redirected, but the withdrawal payload (recipient address, amount, fee)
was exposed. Notify affected users.
