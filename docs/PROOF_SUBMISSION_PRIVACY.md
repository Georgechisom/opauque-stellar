# Proof Submission Privacy

Opaque proofs hide the private input that authorized an action, but the transaction that carries the proof still lands on a public Stellar ledger. Treat proof submission as a visible network event and design timing, memo, and relayer choices accordingly.

## What observers can learn

- A proof transaction happened at a specific ledger time.
- The submitting account, contract ID, fee, operation shape, and success or failure are visible.
- Public proof inputs such as recipient, withdrawal amount, relayer address, nullifier, root, or disclosed reputation fields remain visible when the contract requires them.
- Memo fields and transaction metadata are public. A unique memo can link an otherwise private withdrawal to an off-chain support ticket, payment request, or user session.
- RPC, Horizon, gateway, and relayer operators can observe request timing before the transaction is finalized.

## What observers should not learn from a valid proof

- Which deposit note funded a privacy-pool withdrawal.
- The stealth receive account that originally discovered or swept funds, unless the user links it through a separate transaction.
- Private witness values used to build the Groth16 proof.

These properties depend on the user verifying roots locally, avoiding proof reuse, and submitting only through contract methods that bind the intended recipient, amount, fee, relayer, and pool scope.

## Timing and batching mitigations

- Wait before submitting when instant withdrawal would correlate with a recent deposit, sweep, or off-chain conversation.
- Prefer relayer submission for withdrawals that should not be linked to the connected wallet.
- Batch operational submissions such as root publication on a predictable cadence so individual users are not singled out by unusual timing.
- Avoid retry loops that submit several failed proofs in quick succession. Refresh roots and regenerate once instead.
- Do not add user-specific memos unless the receiving service strictly requires them.

## Relayer considerations

A relayer improves wallet-link privacy because the relayer, not the user wallet, submits the final withdrawal transaction. It does not make the transaction invisible. The relayer can still see the job arrival time, encrypted payload metadata, and its own submission timing. Choose relayers with sufficient stake and completion history, and resubmit through another relayer when a job stalls.

## UI guidance

Before submitting a proof, tell users:

- proof validity is checked on-chain;
- public inputs and transaction timing remain public;
- memo fields should be empty unless required;
- waiting or using a relayer may reduce timing correlation;
- no UI should promise absolute privacy.
