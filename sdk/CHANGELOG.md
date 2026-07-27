# @opaquecash/stellar

## Versioning & Deprecation Policy

This SDK follows [Semantic Versioning](https://semver.org/):

- **Patch** (`0.x.Z`): backward-compatible bug fixes, documentation, internal
  refactors that do not change the public API surface.
- **Minor** (`0.Y.0`): new functionality that is backward-compatible (new optional
  parameters, new exports, new subpath modules).
- **Major** (`X.0.0`): any breaking change to the public API (removed exports,
  changed parameter types, dropped Node versions).

### What counts as a breaking change?

- Removing or renaming a public export, function, class, type, or constant.
- Changing the signature of a public function (required parameters, return type).
- Dropping support for a Node.js major version that was previously listed in `engines`.
- Changing default values for configuration options that alter observable behaviour.

### Deprecation windows

When a public API is deprecated it will:

1. Emit a console warning on first use (via a deprecation wrapper).
2. Remain functional for **at least two minor releases** (or six months, whichever is
   longer) before removal.
3. Be documented in this CHANGELOG under a **Deprecations** heading in the minor
   release that introduces the deprecation.

### Changelog format

Each release entry follows the [Changesets](https://github.com/changesets/changesets)
convention:

```
## <version>

### <Patch|Minor|Major> Changes

- Description of the change (#issue-or-pr).
```

Entries are listed newest-first. Deprecated APIs are called out explicitly.

---

## 0.3.0

### Minor Changes

- Added pluggable inclusion policy engine to the ASP (#623).
- Added publication monitoring with configurable staleness alerting (#624).
- Added ledger reorg guard with continuity verification and safe re-index (#625).

### Deprecations

- `screeningPolicy()` in `asp/src/policy.ts` is soft-deprecated in favour of the
  new `PolicyEngine` class which provides audit logging, composition strategies,
  and a cleaner registration API. It will continue to work for at least two minor
  releases.

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
