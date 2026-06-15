# CI/CD Guide

Opaque Stellar uses GitHub Actions to keep the repository shippable. CI covers application code, contracts, circuits, manifests, and service workspaces.

## Workflows

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | Pull requests and pushes to `main` or `master`. | Required development gate. |
| Mainnet Release | `.github/workflows/release.yml` | Pull requests and pushes to `main` or `release/*`. | Release gate and artifact metadata path. |

## CI Jobs

| Job | Checks |
| --- | --- |
| Deployment manifests | Manifest schema, no legacy Solana or devnet config, security register validation, lockfile presence. |
| Supply chain | `cargo audit`, `cargo deny`, and npm audit reports for root, frontend, relayer, and circuits. |
| Scanner | Rust WASM build and scanner artifact hash verification. |
| Circuit regression | Circom install, circuit dependencies, released artifact fetch, fixture regression, and circuit hash checks. |
| Frontend | Manifest env verification, scanner hash check, lint, TypeScript, production build, and Vitest. |
| Contracts | Rust formatting, clippy, workspace tests, Stellar contract build, and optional on-chain WASM hash check. |
| ASP | TypeScript typecheck and Vitest unit tests. |
| Relayer | TypeScript typecheck and Vitest unit tests. |

The `ci-success` job fails the workflow if any required job fails or is cancelled.

## Release Gates

The release workflow validates deployment manifests, checks the mainnet security register, builds contracts, computes WASM hashes, builds scanner and frontend artifacts, runs audits, and uploads deployment metadata.

Mainnet remains blocked until the security register is explicitly signed off.

## Local Preflight

Run these before pushing changes that touch shared code:

```bash
npm run verify:deployment
npm run verify:security-audit
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npx tsc -b --noEmit
npm run build
npm test
```

ASP:

```bash
cd asp
npm ci
npm run typecheck
npm test
```

Relayer:

```bash
cd relayer
npm ci
npm run typecheck
npm test
```

Circuits:

```bash
npm run fetch:circuits
npm run test:circuits
npm run verify:artifacts
```

## Last CI Failure Fixed

The last failed push exposed two workflow issues:

1. TypeScript verification ran before root dependencies were installed, so `tsx` was missing.
2. The Soroban contract formatting gate failed in `contracts/relayer-registry`.

The workflows now install root tooling before `npm run verify:*` and the contract code has been formatted with `cargo fmt`.

## Operational Notes

Do not run live ASP or relayer indexers in CI. Those services submit real testnet transactions when configured with secrets. CI only typechecks and unit-tests them.

Never store deployer, ASP, relayer, or Freighter secrets in GitHub workflow files. Use GitHub Actions secrets for automation and prefer dedicated testnet keys.
