# Deprecation Policy

This document describes how the Opaque SDK and ASP handle deprecated APIs.

## Semantic versioning guarantees

| Change type | Version bump | Example |
|---|---|---|
| Bug fix, docs, internal refactor | **Patch** (`0.x.Z`) | Fix typo in error message |
| New feature, optional param, new export | **Minor** (`0.Y.0`) | Add `PolicyEngine` class |
| Removed export, changed type, dropped Node | **Major** (`X.0.0`) | Remove `screeningPolicy()` |

## What counts as a breaking change

- Removing or renaming a public export, function, class, type, or constant.
- Changing the signature of a public function (required parameters, return type).
- Dropping support for a Node.js major version listed in `engines`.
- Changing default values that alter observable behaviour.

## Deprecation windows

When a public API is deprecated:

1. A `console.warn` fires on first use (via a deprecation wrapper where feasible).
2. The API stays functional for **≥ 2 minor releases** or **6 months** (whichever is longer).
3. The deprecation is documented in `CHANGELOG.md` under a **Deprecations** heading.

## Changelog discipline

Each release uses the [Changesets](https://github.com/changesets/changesets) format:

```
## <version>

### <Patch|Minor|Major> Changes

- Description (#issue-or-pr).
```

Entries are listed newest-first. Deprecated APIs are called out explicitly.
