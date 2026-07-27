# Contributing Guide

## Event ABI Changes

Before changing what a contract publishes via `env.events().publish(...)`,
read [ADR-0006: Contract event ABI versioning policy](adr/0006_event_abi_versioning_policy.md).
It defines when bumping that contract's `EVENT_VERSION` is mandatory and the
required update order across the scanner, SDK, and frontend.

## Scanner WASM Rebuilds

When modifying scanner code, contributors must verify their rebuild is byte-identical to the pinned artifact before pushing.

### Quick Check

```bash
npm run check:scanner-stability
```

This command:
1. Rebuilds the scanner WASM via `wasm-pack`
2. Computes the SHA-256 hash of the built artifact
3. Compares it against the pinned hash in `artifacts/manifest.json`
4. Reports **identical** or **differing** with hashes

If the output reports **DIFFERENT**, run the manifest update procedure:

```bash
npm run update:artifacts
npm run verify:artifacts -- --scanner
git add frontend/public/pkg/cryptography_bg.wasm artifacts/manifest.json
git commit -m "update scanner WASM artifact"
```

### Verification

After updating, verify the manifest is correct:

```bash
npm run verify:artifacts -- --scanner
```

## Code Style

- Rust code follows `rustfmt` conventions.
- TypeScript code follows the existing ESLint configuration.
- Each file edit should have a separate commit message.

## Testing

- Run `cargo test` in the `scanner/` directory for Rust unit tests.
- Run `npm test` in the `sdk/` directory for SDK unit tests.
- Run `npm test` in the `frontend/` directory for frontend unit tests.
