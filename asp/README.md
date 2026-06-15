# @opaquecash/asp

The **Association Set Provider** for the Opaque privacy pool, with a Stellar/Soroban chain
adapter. It is the off-chain curator that decides which deposits are "clean" and publishes
the **association-tree root** that the withdraw circuit proves against. For the testnet
demo it also publishes the mechanical pool **state-tree root** reconstructed from public
`Deposit`/`Withdraw` events, so the browser wallet has both roots required for withdrawal.

```
npm install
npm run typecheck
npm test            # engine reconcile, set/tree, policy, store (offline)
ASP_SECRET=S... npm run indexer:once   # one live reconcile pass against testnet
ASP_SECRET=S... npm run indexer        # loop every ASP_INTERVAL_MS
```

## What it does (per tick)

`runPoolTick` (`src/engine.ts`):

1. **Read** finalized `Deposit` events from the `privacy-pool` contract (`src/chains/stellar.ts`,
   Soroban `getEvents`, respecting the exact-length topic-match rule).
2. **Screen** each via a pluggable `Policy` (`src/policy.ts`). The shipped v1 policy is
   `approveAll` — every testnet deposit is approved — with an `allowlist` stub and a
   documented `screeningPolicy` hook for real sanctions/risk screening.
3. **Maintain** the ordered approved set and rebuild a depth-20 Poseidon(2) tree
   (`src/set.ts` + `src/merkle.ts`) byte-identical to the `privacy-pool` contract and the
   v3 circuit.
4. **Reconcile ASP**: compare the local association root to the on-chain root and, only on mismatch,
   publish the manifest (`data/sets/<poolId>/<root>.json`) and post `update_asp_root`.
   Reconcile-not-append makes it idempotent and self-healing — a crash mid-publish is
   resolved on the next tick.
5. **Reconcile state**: rebuild the pool state tree from `Deposit` commitments and
   `Withdraw` remainder commitments, then post `update_state_root` only when it differs
   from the latest on-chain state root.

## Trust boundary — liveness + curation, never integrity

The ASP **cannot mint, steal, or forge double-spends.** It only gates withdrawal
*eligibility*:

- The published label list is **self-authenticating**: a withdrawer recomputes the Merkle
  root locally and checks it equals the on-chain `aspRoot`, so a bad list simply fails
  proof generation.
- **State-tree** (commitment) membership — which proves a deposit is real and backed — is
  rebuilt from public pool events and verified against the on-chain state root. The demo
  ASP process publishes that root, but it does not choose the leaves.
- The `privacy-pool` contract enforces a **custody invariant** (aggregate withdrawals ≤
  aggregate deposits) and the SAC balance is the physical backstop, so even the state-root
  publisher cannot authorize unbacked withdrawals.

Under `approveAll`, clients can skip this service entirely and reconstruct the set straight
from on-chain `Deposit` events; the manifest/IPFS path only matters once a selective policy
is used.

## Config (env / `.env`)

| Var | Default | Meaning |
|-----|---------|---------|
| `STELLAR_RPC_URL` | testnet RPC | Soroban RPC endpoint |
| `ASP_SECRET` | — (required) | ASP authority `S…` seed (the pool admin in the demo) |
| `ASP_INTERVAL_MS` | `15000` | loop interval |
| `ASP_CONFIRMATIONS` | `1` | confirmations before a deposit is treated as final |
| `IPFS_API_URL` | — | optional manifest pinning endpoint |

Pool id + scope are resolved from `deployments/v1/testnet.json`.
