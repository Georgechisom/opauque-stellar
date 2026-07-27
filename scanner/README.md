# Scanner Engine

Rust/WASM implementation of the DKSAP (EIP-5564-style) stealth-address scanner:
view-tag prefiltering, stealth-address derivation, and attestation matching for
the Opaque Cash protocol. Compiled via `wasm-bindgen` and consumed by the
frontend/SDK through the generated bindings in `src/lib.rs`.

See `src/scanner.rs` for the core DKSAP math and `src/attestation.rs` for
reputation-attestation scanning.

## Performance

### Concurrent announcement fetching (#603)

The frontend's `useScanner` hook (`frontend/src/hooks/useScanner.ts`) fetches
announcement pages from the chain with bounded concurrency
(`DEFAULT_FETCH_CONCURRENCY`, default 4 concurrent `getEvents` calls) instead
of one page at a time, while still delivering pages to callers in strict
ascending order — cache writes, sync-state updates, and progress reporting
see identical results to the previous fully-sequential implementation.

### Large-scale scan benchmark (#604)

`sdk/scripts/benchmark-scan.ts` generates a deterministic synthetic fixture
(default 120,000 announcements, seeded PRNG) and benchmarks the pure-TS
reference scanner (`scanAnnouncementsViewOnly`) against it, reporting
throughput and heap usage. Run it from `sdk/`:

```bash
npm run benchmark:scan
# or with an explicit fixture/chunk size:
npx tsx scripts/benchmark-scan.ts 200000 10000
```

Results are written below automatically each time the script runs.

<!-- benchmark-scan:latest -->
### Latest benchmark run

- **Run at**: 2026-07-27T16:18:56.881Z
- **Fixture size**: 120,000 announcements (24 planted true positives, verified found: 24)
- **Chunk size**: 10,000
- **Scan time**: 315,807 ms
- **Throughput**: 380 announcements/sec
- **Heap usage**: baseline 87.5 MB → peak 150.1 MB → final 69.2 MB

Reproduce with: `npx tsx scripts/benchmark-scan.ts [fixtureSize] [chunkSize]` from `sdk/`.

## Memory & responsiveness (frontend)

- **WASM memory exhaustion handling (#605)**: `frontend/src/workers/scannerWorker.ts`
  monitors JS heap usage (via `performance.memory` where available, with a
  hard iteration-count fallback on engines that don't expose it) during a
  scan and aborts cleanly with a resumable cursor rather than letting the
  WASM module trap on an out-of-memory condition. See
  `shouldAbortForMemoryPressure` and `MEMORY_PRESSURE_RATIO`.
- **Web worker offloading (#606)**: the same worker moves trial decryption
  (view-tag + full stealth-address match checks) off the main thread, wired
  into `PrivateBalanceView` via `frontend/src/hooks/useScannerWorker.ts`.
  Progress messages are rate-limited (`progressIntervalMs`, default 150ms) so
  the UI isn't flooded with updates on large histories.
