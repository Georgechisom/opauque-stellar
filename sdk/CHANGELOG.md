# @opaquecash/stellar

## 0.2.0

### Minor Changes

- Require Node.js >= 20 (Node 18 is end-of-life; the toolchain and Web Crypto
  globals need 20+).
- Release tooling: tag-driven publish workflow with npm provenance, a clean-room
  install gate, Changesets, and build-time version injection.

## 0.1.1

### Patch Changes

- Lazy-load `circomlibjs` so payments-only consumers do not need it installed; the
  package now imports cleanly with only its required peers.
- Document pinning `@noble/*` peers to v1 (v2 is a breaking API change).
- Fix CJS/ESM type resolution (conditional `types` per `import`/`require`).

## 0.1.0

### Minor Changes

- Initial release. A typed, framework-free SDK for Stellar/Soroban:
  - **payments** — DKSAP stealth addresses (derive, register, send, pure-TS scan, sweep)
  - **pool** — privacy-pool deposit/withdraw with Groth16 proving and on-chain
    state reconstruction
  - **reputation** — on-chain ZK reputation (Groth16 verified in a Soroban contract)
  - **relayer** — relayer-market job lifecycle + gateway client
  - injected config, signer adapters, typed errors, storage/telemetry hooks
  - ESM + CJS + type declarations, subpath exports (`/crypto`, `/relayer-protocol`)
