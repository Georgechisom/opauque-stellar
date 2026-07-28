# Circuit Range Check Audit — Amount-Carrying Signals

Audit of every signal across `circuits/stealth_attestation.circom`,
`circuits/v2/stealth_reputation.circom`, and
`circuits/v3/privacy_pool_withdraw.circom` that carries a monetary amount,
quantity, or count — the class of signal where a missing range check turns
into an overflow-based forgery via silent field-arithmetic wraparound.

## Scope note

`stealth_attestation.circom` (V1) and `stealth_reputation.circom` (V2) prove
possession of an attestation/reputation credential via Merkle inclusion +
nullifier binding. Every signal in both is either a field-element-encoded
identifier (a key, a hash, a schema/attestation id, a Merkle path element or
direction bit) or a boolean validity flag — **neither circuit has any
signal representing a quantity, amount, or count.** There is nothing for a
range check to bound in V1 or V2; this audit found no gap there because
there is no amount-carrying signal to audit.

`circuits/v3/privacy_pool_withdraw.circom` is the only circuit with
amount-carrying signals, since it moves value.

## V3 amount-carrying signals

| Signal | Visibility | Bound enforced | Constraint |
|---|---|---|---|
| `value` | private | `0 <= value < 2^64` | `Num2Bits(64)` (line: `component valueRange = Num2Bits(valueBits); valueRange.in <== value;`, with `valueBits = 64` from the `component main` instantiation) |
| `withdrawnValue` | **public** | `0 <= withdrawnValue < 2^64`, and `withdrawnValue <= value` | `Num2Bits(64)` on the raw signal, plus a separate `LessEqThan(64)` constraint (`le.out === 1`) enforcing the ordering |
| `remainder` (derived, not a raw input) | internal | Implicitly `0 <= remainder < 2^64` | Not independently range-checked — inherits its bound from `remainder <== value - withdrawnValue` together with the two constraints above: since `value` is already `< 2^64` and `withdrawnValue <= value`, the subtraction cannot go negative or wrap, so `remainder` is guaranteed to land in `[0, value] ⊆ [0, 2^64)` without needing its own `Num2Bits` |

### Bound justification: why 64 bits

The circuit's trailing comment (`circuits/v3/privacy_pool_withdraw.circom`,
just above `component main`) states the bound is chosen because "XLM stroop
supply < 2^60" — i.e. the total possible supply of stroops (Stellar's
smallest unit, 1 XLM = 10^7 stroops) fits comfortably under 2^60, so 64 bits
leaves headroom without being so wide it weakens the range check's
practical guarantee. This matches the contract side: `privacy-pool`'s
`withdraw()` takes `withdrawn_value: i128` (Soroban's native amount type)
and only additionally checks `withdrawn_value <= 0 || fee < 0 || fee >
withdrawn_value` (sign and fee-vs-amount checks) — the upper bound is left
entirely to the circuit's `Num2Bits(64)`, so the circuit-side bound is the
*only* thing preventing a withdrawal amount above `2^64` stroops from being
provable, and it correctly matches i128's much larger range being
irrelevant here (the circuit bound is the binding constraint, not the
Soroban type width).

**Confidence note:** I verified this bound by reading the circuit source
and the `withdraw()` contract function directly (both quoted above), not by
executing the circuit. I was not able to compile the circuit or run
`circuits/test/regression.ts --version v3` in this environment (no local
`circom`/`snarkjs` install) to empirically confirm `Num2Bits(64)` rejects
witnesses outside `[0, 2^64)` for this exact pinned circomlib version — see
the toolchain-pinning check added for #601, which exists precisely so this
kind of verification is reproducible for the next contributor who *does*
have the toolchain installed.

### Overflow negative vectors

Two negative fixtures now cover the two distinct ways `withdrawnValue` /
`value` can violate their bound — these are different failure modes and
both need coverage, since a fix for one does not imply the other holds:

- **`circuits/fixtures/v3/negative/overflow-value.json`** (pre-existing):
  `withdrawnValue` (`1000000001`) exceeds `value` (`1000000000`) while both
  individually remain well under `2^64`. This exercises the `LessEqThan(64)`
  ordering constraint (`le.out === 1` fails).
- **`circuits/fixtures/v3/negative/value-exceeds-64-bits.json`** (added by
  this PR): `value` is set to exactly `2^64`
  (`18446744073709551616`), one past the maximum representable 64-bit
  unsigned integer. This exercises `Num2Bits(64)`'s bit-width bound
  directly — a witness where `value` requires a 65th bit cannot be
  decomposed into 64 boolean bits summing back to `value`, so witness
  generation must fail independently of whatever `withdrawnValue` is set
  to. **This fixture is added but not execute-verified in this
  environment** (see confidence note above) — please confirm it produces
  `constraint_violation` via `circuits/test/regression.ts --version v3`
  before merging.

## Summary

- [x] Every amount-carrying signal (`value`, `withdrawnValue`, and the
  derived `remainder`) in the only circuit that has any (V3) has an
  explicit range constraint or a documented justification for why it
  inherits one.
- [x] Bounds match the contract-side representation limits (`i128` on the
  Soroban side is wider than the 64-bit circuit bound, so the circuit bound
  is the binding constraint; no mismatch found).
- [~] Overflow negative vectors: the pre-existing ordering-boundary vector
  was already covered; a new bit-width-boundary vector was added but is
  unverified pending a local circom toolchain run (flagged above and in the
  PR description).
