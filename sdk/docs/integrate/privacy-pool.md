# Integrate: Privacy Pool

End-to-end shielded deposit and withdrawal: deposit XLM into the pool, generate a
zero-knowledge withdrawal proof, and withdraw to any recipient — breaking the
link between deposit and withdrawal. See [Privacy Pool](/concepts/privacy-pool)
for the model.

## Prerequisites

```sh
npm install @opaquecash/stellar "@stellar/stellar-sdk" "@noble/curves@^1" "@noble/hashes@^1" circomlibjs snarkjs
```

- `circomlibjs` — Poseidon hashing for commitments (deposit + withdraw).
- `snarkjs` — Groth16 proof generation (withdraw only).
- **Circuit artifacts** — the v3 `privacy_pool_withdraw.wasm` + `.zkey`, resolved
  via an `ArtifactResolver` (required for `proveWithdraw`).
- A **`NoteStore`** — notes are your spending material; losing one loses the
  funds. Use a persistent store in production (the default is in-memory).

```ts
import { OpaqueClient, keypairSigner, urlArtifactResolver } from "@opaquecash/stellar";

const opaque = new OpaqueClient({
  network: "testnet",
  signer: keypairSigner(process.env.STELLAR_SECRET!),
  artifacts: urlArtifactResolver({ baseUrl: "https://your-cdn.example" }), // serves circuits/v3/*
  storage: { notes: myPersistentNoteStore },                              // implements NoteStore
});
```

## Step 1 — Deposit

`deposit` reads the next leaf index, derives the commitment from fresh secrets,
submits the on-chain deposit, and **persists the note** to your `NoteStore`.

```ts
const { note, txHash } = await opaque.pool.deposit({ amountXlm: "5" });
// note.commitment — the on-chain leaf
// note.nullifier / note.secret — spending material (persisted; back these up!)
```

Back up notes out-of-band — encrypt them with the [backup helpers](/api/) and
store them somewhere the user controls.

## Step 2 — Wait for the roots to cover your deposit

Withdrawals prove against the **published** state + ASP roots. An indexer/ASP
publishes those roots; until they include your deposit, a withdrawal can't be
proven. Poll until both roots are present:

```ts
const roots = await opaque.pool.getRoots();
// roots.state / roots.asp — Uint8Array (published) or null (not yet)
if (!roots.state || !roots.asp) {
  // ASP/indexer hasn't published a root covering recent deposits yet — wait and retry.
}
```

## Step 3 — Generate the withdrawal proof

`proveWithdraw` reconstructs the pool's commitment tree from on-chain
Deposit/Withdraw events automatically, builds the witness, and produces a
Groth16 proof bundle. Requires the `artifacts` resolver.

```ts
const proof = await opaque.pool.proveWithdraw({
  note,
  recipient: payoutAddress, // who receives the withdrawn XLM
  // optional: fee, relayer (default 0 / recipient), scope (default pool scope)
});
```

::: tip Faster proving with cached state
`proveWithdraw` reads chain events each call. If you already have the
reconstructed leaves, pass `stateLeaves` + `depositIndices` to skip the read —
get them from `opaque.contracts.privacyPool.reconstructState({ startLedger })`.
:::

## Step 4 — Withdraw

Submit the proof. On success, mark the note spent so it isn't reused:

```ts
const withdrawTx = await opaque.pool.withdraw({
  proof,
  recipient: payoutAddress,
  noteCommitment: note.commitment, // marks the note spent in your NoteStore
});
```

The contract verifies the proof, enforces nullifier-replay protection and root
validity, and pays the recipient. To withdraw through a market relayer instead of
your own wallet (so the submitting account isn't yours), see
[Relayer Market](/integrate/relayer-market) — you pass this same `proof`.

## Full end-to-end script

```ts
import { OpaqueClient, keypairSigner, urlArtifactResolver } from "@opaquecash/stellar";

const opaque = new OpaqueClient({
  network: "testnet",
  signer: keypairSigner(process.env.STELLAR_SECRET!),
  artifacts: urlArtifactResolver({ baseUrl: ARTIFACT_BASE_URL }),
  storage: { notes: myNoteStore },
});

// 1. deposit
const { note } = await opaque.pool.deposit({ amountXlm: "5" });

// 2. wait for roots
let roots = await opaque.pool.getRoots();
while (!roots.state || !roots.asp) {
  await new Promise((r) => setTimeout(r, 5000));
  roots = await opaque.pool.getRoots();
}

// 3. prove + 4. withdraw
const proof = await opaque.pool.proveWithdraw({ note, recipient: PAYOUT });
await opaque.pool.withdraw({ proof, recipient: PAYOUT, noteCommitment: note.commitment });
```

## Notes & errors

- **Full withdrawals only (v1):** the change leaf is a throwaway zero-value
  commitment. Partial withdrawals are a planned follow-up.
- `NotWiredError` from `proveWithdraw` → no `artifacts` resolver configured.
- `RootUnavailableError` / empty roots → the ASP/indexer hasn't published a root
  covering your deposit yet; retry.
- `ContractError` on `withdraw` → e.g. nullifier already spent (note reused) or a
  stale root; inspect `.contractCode`.
