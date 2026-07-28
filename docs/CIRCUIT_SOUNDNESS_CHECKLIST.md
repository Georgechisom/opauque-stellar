# Circuit Soundness Review Checklist

Any PR that adds or modifies a `.circom` file (`circuits/`, `circuits/v2/`,
`circuits/v3/`) must complete this checklist and paste the completed copy
into the PR description before requesting review. A standard code-review
pass does not catch the failure modes below — they are silent: the circuit
compiles, the tests that exist still pass, and the bug only surfaces as a
forged proof accepted on-chain, months later.

This checklist is deliberately narrow. It does not replace a real audit for
a change to the trusted setup, the pairing check, or a new proof system —
escalate those to `@collinsadi` and, for anything touching
`groth16-verifier` or a new circuit going to mainnet, an external audit
before deployment.

## 1. Under-constrained signals

An under-constrained signal is one whose value the prover can choose freely
without it being pinned down by `<==`/`===`, letting a malicious prover
substitute an unintended value while every constraint still checks out.

- [ ] Every `signal input` and `signal` (intermediate) is either:
  - assigned via `<==` from a deterministic combination of other
    constrained signals (a hash, a linear combination, a witness the circuit
    itself computes), **or**
  - explicitly bound to a public input via `===`.
- [ ] No signal is only used inside a `<--` (witness-only assignment without
  a paired `===`/`<==` constraint). `<--` is legitimate for things like
  quotient/remainder witnesses in a division gadget, but every such signal
  must be re-constrained immediately after (e.g. `q * divisor + r === in`,
  plus a range check on `r`).
- [ ] For every `component` (sub-circuit instantiation), all of its declared
  `signal input`s are wired — an unwired input silently defaults to `0` in
  circom, which can turn a real check into `0 === 0`.
- [ ] Boolean "gate" signals (used as multiplexer selectors, validity flags)
  are constrained to `{0,1}` explicitly, e.g. `s * (1 - s) === 0` — see
  `MerkleInclusion`'s `pathIndices[i] * (1 - pathIndices[i]) === 0` in
  `circuits/v3/privacy_pool_withdraw.circom` for the existing pattern to
  match.
- [ ] If the circuit combines multiple boolean checks into a single validity
  output (as V1's `is_valid <== root_valid * attest_valid` does), confirm
  the multiplication is over genuinely boolean signals — multiplying two
  non-boolean signals does not produce an AND gate.

## 2. Missing range checks

Field arithmetic wraps silently at the scalar field modulus. A signal that
is meant to represent a bounded integer (an amount, an index, a count) but
is never range-checked can be given a field element that is
mathematically valid but represents an unintended (and possibly negative,
via wraparound) integer.

- [ ] Every signal that represents a monetary amount, quantity, or count has
  an explicit `Num2Bits(n)` (or equivalent) constraint pinning it to `n`
  bits, where `n` matches the real-world representation limit (see
  [`docs/CIRCUIT_RANGE_CHECK_AUDIT.md`](CIRCUIT_RANGE_CHECK_AUDIT.md) for
  the bound each existing amount signal uses and why).
- [ ] Any subtraction between two range-checked values that must not go
  negative (e.g. `remainder = value - withdrawnValue`) has a `LessEqThan`
  (or equivalent) constraint enforcing the operand ordering *before* the
  subtraction, not just a range check on the result — the result can be
  in-range while still being the wrong value if the field wrapped.
- [ ] Merkle path index arrays and any other "small enum" signal (direction
  bits, a scenario/version selector) are range-checked to their valid set,
  not just implicitly assumed to be `0` or `1`.
- [ ] A new negative-vector fixture (`circuits/fixtures/<version>/negative/`)
  exists for each new range check, exercising a value one past the
  boundary — see `overflow-value.json` and
  `value-exceeds-64-bits.json` for the two distinct failure modes a
  bounded-subtraction signal needs (the comparison boundary and the raw
  bit-width boundary).

## 3. Public input binding

A proof is only meaningful if every value the verifier and calling contract
care about is a **public** signal that the circuit actually constrains —
otherwise the prover can supply any private value they like and the
on-chain check learns nothing about it.

- [ ] Every value the on-chain verifier reads out of `publicSignals` (check
  `component main {public [...]}`) is genuinely constrained inside the
  circuit body, not merely declared public and left as a free variable.
- [ ] Values that must match something the contract already knows (a
  Merkle root it stores, a nullifier it will mark spent, an
  attestation/schema id it's checking against) are bound with `===`
  against a **public** input — binding against a private signal doesn't
  stop a malicious prover from picking whatever private value they want.
- [ ] If the proof is meant to be scoped to a specific action/context (a
  relayer fee, a recipient address, a vote id, an external nullifier), that
  context is derived the same way on-chain and in the circuit, and the
  circuit binds it with a constraint the prover cannot satisfy for a
  different context — see `context` in
  `circuits/v3/privacy_pool_withdraw.circom` (`contextSq <== context *
  context`, matched by the contract recomputing `context` from
  `recipient`/`fee`/`relayer`/`withdrawnValue`/`scope` before calling the
  verifier).
- [ ] `component main {public [...]}`'s signal order matches, byte for byte,
  the order the on-chain verifier expects (`publicSignalOrder` in
  `circuits/test/regression.ts` and the `VerifyPublicInputsV*` struct field
  order in `contracts/groth16-verifier/src/lib.rs`) — a reordering compiles
  fine and silently binds the wrong signal to the wrong verifier slot.
- [ ] Nullifiers are derived from a value that's both privately known to
  the real owner and bound into the same proof as the rest of the
  statement (not computable independently of the other constraints) — see
  `nullifierHash === Poseidon(nullifier)` in the V3 circuit as the pattern.

## Recording completion in the PR

Paste this filled-in table into the PR description (see
[Section 9 of CONTRIBUTING.md](../.github/CONTRIBUTING.md#9-pull-request-process)):

```markdown
## Circuit soundness checklist (docs/CIRCUIT_SOUNDNESS_CHECKLIST.md)

- [x] 1. Under-constrained signals — reviewed, no issues found
- [x] 2. Missing range checks — reviewed, added Num2Bits(N) on `<signal>`
- [x] 3. Public input binding — reviewed, no issues found
```

If a box can't be checked, the PR is not ready for review — either fix the
gap or, if it's a deliberate, justified exception, say so explicitly next
to the unchecked box and get sign-off from `@collinsadi` before merging.
