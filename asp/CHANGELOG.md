# @opaquecash/asp

## Versioning & Deprecation Policy

This package follows [Semantic Versioning](https://semver.org/):

- **Patch** (`0.x.Z`): backward-compatible bug fixes and internal refactors.
- **Minor** (`0.Y.0`): new functionality that is backward-compatible.
- **Major** (`X.0.0`): any breaking change to the public API.

### Deprecation windows

Deprecated APIs remain functional for **at least two minor releases** (or six months,
whichever is longer) before removal. Deprecations are logged under a **Deprecations**
heading in the relevant release.

### Changelog format

```
## <version>

### <Patch|Minor|Major> Changes

- Description (#issue).
```

Entries are listed newest-first.

---

## 0.2.0

### Minor Changes

- Pluggable inclusion policy engine with composable strategies and audit logging (#623).
- Publication monitor that alerts when the ASP root exceeds a staleness threshold (#624).
- Ledger reorg guard with continuity verification and safe re-index path (#625).

### Deprecations

- `screeningPolicy()` in `src/policy.ts` is soft-deprecated in favour of the new
  `PolicyEngine` class.

## 0.1.0

### Minor Changes

- Initial release: association set provider with approve-all demo policy, Stellar/Soroban
  chain adapter, depth-20 Poseidon(2) Merkle tree, file-backed state store, and the
  `runPoolTick` reconcile loop.
