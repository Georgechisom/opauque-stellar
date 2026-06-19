# Privacy Pool

The privacy pool is a shielded balance: deposits add a commitment to a Merkle
tree, and withdrawals prove (in zero knowledge) that they spend an unspent
commitment without revealing which one.

## Commitments and notes

A **note** is the client-side spending material for one deposit. Its derivations
byte-match the v3 circuit and the `privacy-pool` contract:

```
label         = Poseidon(scope, leafIndex)
precommitment = Poseidon(nullifier, secret)
commitment    = Poseidon(value, label, precommitment)   ← the tree leaf
nullifierHash = Poseidon(nullifier)                      ← spend marker
```

Losing a note loses the funds, so persist notes through a `NoteStore` and back
them up.

## Off-chain root, on-chain custody

On-chain Poseidon is infeasible on Stellar (~40M CPU instructions per hash
against a 100M per-transaction budget), so the pool does **not** hash the tree
on-chain. Instead:

- the commitment **state root** is published off-chain (with history + expiry +
  a dataset hash), alongside an **ASP root** for compliance screening, and
- the contract enforces an on-chain **custody invariant**: withdrawals are capped
  at deposits and the SAC balance is the physical backstop.

This is a documented trust trade-off (a trusted state-root publisher) acceptable
for the current testnet deployment.

## Deposit and withdraw

```ts
const { note } = await opaque.pool.deposit({ amountXlm: "5" });

// generate a full-withdrawal proof — the pool leaves are reconstructed from
// on-chain Deposit/Withdraw events automatically
const proof = await opaque.pool.proveWithdraw({ note, recipient });

await opaque.pool.withdraw({ proof, recipient, noteCommitment: note.commitment });
```

Pass `stateLeaves` + `depositIndices` to `proveWithdraw` to skip the on-chain
read (e.g. in tests, or when you already have the reconstructed tree).

v1 supports **full withdrawals** (the change commitment is a throwaway
zero-value leaf); partial withdrawals are a planned follow-up. The withdrawal
binds recipient, amount, fee, relayer, and scope into the proof context, so a
relayer cannot alter them — see the [Relayer Market](/concepts/relayer-market).
