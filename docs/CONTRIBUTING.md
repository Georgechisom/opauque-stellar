# Contributing Guide

## Quick Start

1. Clone the repo and install prerequisites (Rust, [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup),
   Node.js 18+, `wasm-pack`, [Freighter](https://www.freighter.app/)) — see the
   root [`README.md`](../README.md) for the full local setup.
2. **Fund a testnet account before touching the wallet UI.** Every flow in the
   frontend (registration, stealth sends, privacy-pool deposits) needs a funded
   Stellar account to sign and pay fees with. Follow the
   [testnet faucet and funding guide](testnet-faucet-guide.md) to get test XLM
   via Friendbot, decide which network to run locally against, and avoid the
   most common "why is my transaction failing" gotchas.
3. Build contracts and the scanner WASM, then run the frontend:
   ```bash
   stellar contract build
   cd scanner && wasm-pack build --target web --out-dir ../frontend/public/pkg && cd ..
   cd frontend && cp .env.example .env && npm install && npm run dev
   ```
4. Open `http://localhost:5173`, connect Freighter on testnet (make sure
   Freighter itself is switched to Testnet), and connect with the account you
   just funded.
5. Run `cd frontend && npm run test:e2e` for the Playwright suite before
   opening a PR that touches the wallet UI — see [`frontend/e2e/README.md`](../frontend/e2e/README.md)
   for what's covered and how the Freighter wallet is mocked.

## Reporting security or funds-affecting issues

Do not open a public issue for anything that could put user funds at risk —
see [`SECURITY.md`](../SECURITY.md). Once an incident is declared, the
communication templates in [`docs/ops/incident/`](ops/incident/) are used to
notify users and integrators.

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
