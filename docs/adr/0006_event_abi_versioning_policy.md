# ADR-0006: Contract event ABI versioning policy

**Date:** 2026-07-27
**Status:** Accepted
**Context:** Off-chain consumers (scanner, SDK, frontend) decode contract events by fixed shape; there was no written rule for evolving that shape safely.

## Problem statement

Every Soroban contract in this repo publishes events with an `EVENT_VERSION`
constant in the topic tuple (e.g. `(Symbol::new(&env, "Announcement"),
EVENT_VERSION)`), but until now that constant existed without a documented
policy: nothing said when a contributor must bump it, what changes are safe
without a bump, or in what order the off-chain consumers (scanner WASM, SDK,
frontend) need to be updated relative to a contract upgrade. A contributor
changing an event's payload shape had no written guidance and could easily
ship a contract change that silently breaks decoding for every deployed
frontend/indexer, or bump the version unnecessarily and force a needless
coordinated rollout.

## Context

Off-chain code is tightly coupled to on-chain event shapes in several places:

- `frontend/src/lib/chainSync.ts` and `frontend/src/hooks/useScanner.ts`
  decode `Announcement`, `SchemaRegistered`, `DelegateAdded`/`DelegateRemoved`,
  and `AttestationCreated` events by **positional** field access
  (`ev.data[1]`, `ev.data[2]`, ...) after routing on the topic `Symbol`.
- The stealth-announcer's `Announcement` topic is documented in
  `chainSync.ts` as a **two-segment** topic — `(Symbol("Announcement"),
  EVENT_VERSION)` — specifically because Soroban's `getEvents` topic filters
  match positionally and require the filter length to equal the event's
  topic length; a single-segment filter matches nothing once a version
  segment exists.
- `sdk/src/crypto/scan.ts` and the Rust WASM scanner (`scanner/src/lib.rs`)
  assume specific field orders and byte widths for `StealthAnnouncement`
  data extracted from these events.

None of this was wrong — it's the correct design given Soroban's
constraints — but it means an uncoordinated event-shape change breaks
multiple independent consumers simultaneously, with no compiler or type
system to catch it (events are decoded from `ScVal` at runtime).

## Decision

1. **`EVENT_VERSION` is per-contract**, not global — each contract's version
   constant only describes that contract's own event shapes. Contracts
   evolve independently.

2. **A version bump is mandatory when, and only when, an event's payload
   changes in a way that breaks positional decoding for an existing
   consumer.** Concretely, bump `EVENT_VERSION` for:
   - Adding, removing, or reordering fields in an event's data tuple.
   - Changing a field's on-wire type (e.g. `u32` → `u64`, `BytesN<32>` →
     `Bytes`).
   - Changing the meaning of an existing field in place (even if the type
     is unchanged) — e.g. a field that was "ledger sequence" becoming "unix
     timestamp".

   Do **not** bump for:
   - Adding a *new event topic* (a new kind of event) — only existing event
     shapes need version discipline, since a new topic can't break decoding
     of an existing one.
   - Internal contract logic changes that don't touch what's published.
   - Adding fields to non-event contract types (e.g. `PoolConfig`) — those
     aren't ABI in this sense; only `env.events().publish(...)` payloads are.

3. **Consumer update order on a version bump**, always in this sequence:
   1. **Scanner (Rust/WASM)** — update `scanner/src/lib.rs` (and
      `scanner/src/scanner.rs` / `attestation.rs` as applicable) to decode
      both the old and new shapes during the migration window, or the new
      shape only if old events are no longer relevant to scan. Rebuild via
      `npm run build:scanner` and update the pinned artifact hash per
      `docs/CONTRIBUTING.md`'s "Scanner WASM Rebuilds" section.
   2. **SDK (`sdk/src/`)** — update the pure-TS reference implementations
      (`crypto/scan.ts`, `crypto/dksap.ts`) and any typed event interfaces to
      match. The SDK's pure-TS path must stay behaviorally equivalent to the
      WASM path (see ADR-0002), so it's next, not last.
   3. **Frontend** — update `frontend/src/lib/chainSync.ts`,
      `frontend/src/hooks/useScanner.ts`, and any component reading decoded
      event fields directly.

   Updating in this order means the lowest-level consumer (the thing
   everything else depends on for correctness of matching/decryption) is
   never left decoding a shape it doesn't understand while a higher layer
   has already moved on.

4. **The contract change itself must ship a version bump and its consumer
   updates in the same PR** wherever practical. Splitting them across
   separate PRs re-opens exactly the window this policy exists to close.

## Rationale

A rule that's too strict (bump on every contract change) causes needless
coordinated rollouts and rots as a policy nobody follows. A rule that's too
loose (bump "when it seems necessary") gives no actual guidance to a
contributor who doesn't already know the off-chain decoding is positional.
Scoping the bump trigger to "payload shape changes that break positional
decoding" is the narrowest rule that actually protects consumers, and it's
checkable by a reviewer without deep protocol knowledge: does this diff
change what's inside `env.events().publish((topic, EVENT_VERSION), (...))`'s
second tuple?

## Alternatives considered

- **Bump on every contract deployment, regardless of event changes.**
  Rejected — trains contributors to treat version bumps as noise, defeating
  the purpose the first time it actually matters.
- **Schema registry / IDL-driven event definitions with codegen.** Would be
  more robust long-term, but is a significant infrastructure investment
  disproportionate to this repo's current contract count and change
  frequency. Revisit if event-shape breakage becomes a recurring incident.
- **Global `EVENT_VERSION` shared across all contracts.** Rejected — it
  would force unrelated contracts to bump in lockstep, and a single shared
  constant doesn't match Soroban's per-contract event topic namespacing
  anyway.

## Consequences

### Positive
- Contributors have a checkable rule instead of tribal knowledge.
- The consumer update order prevents the "frontend updated first, scanner
  now silently drops matches" failure mode.

### Negative
- Requires discipline to actually check "does this change break positional
  decoding" on every event-touching PR — this policy doesn't enforce itself
  mechanically (see Alternatives: schema registry, deferred).

### Unknown
- Whether the manual-check approach scales as the number of contracts /
  event types grows; revisit with codegen if it doesn't.

## Implementation notes

No code changes are required to adopt this policy — every contract's
`EVENT_VERSION` constant already exists per the established pattern (see
`contracts/privacy-pool/src/lib.rs`, `contracts/stealth-announcer/src/lib.rs`,
`contracts/schema-registry/src/lib.rs`, `contracts/attestation-engine-v2/src/lib.rs`,
`contracts/relayer-registry/src/lib.rs`). This ADR documents the policy those
constants were always implicitly meant to serve, and is linked from
`docs/CONTRIBUTING.md` so it's discoverable by anyone touching event-publishing
code.

## Related decisions

- [ADR-0001](0001_off_chain_published_roots.md) — off-chain published roots
  rely on the same event-driven indexing pattern this policy governs.
- [ADR-0002](0002_browser_wasm_scanner.md) — the WASM scanner is the
  first-in-line consumer per the update order in this ADR.

## References

- Soroban `getEvents` topic filter semantics (positional matching, exact
  segment-length requirement) — documented in-repo at
  `frontend/src/hooks/useScanner.ts`'s `fetchLogsAdaptive` comment.
