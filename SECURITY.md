# Security Policy

## Reporting a vulnerability

**Please do not** open public GitHub issues for security vulnerabilities.

Report them through a **[private GitHub security advisory](https://github.com/collinsadi/opauque-stellar/security/advisories/new)** on this repository.

A useful report includes:

- The affected component and commit or deployment (contract address, frontend build, or scanner version).
- Steps to reproduce, a proof of concept, or the specific code path involved.
- Your assessment of impact (loss of funds, privacy de-anonymization, denial of service, etc.).

We aim to acknowledge security reports within **5 business days** and will keep you updated as we investigate. Please give us a reasonable window to ship a fix before any public disclosure; we are happy to coordinate timing and credit you in the advisory.

We will not pursue legal action against good-faith research that respects user privacy, avoids data destruction, and stays within testnet or your own accounts.

## Reporting abuse or sanctions concerns

Open a **[GitHub issue](https://github.com/collinsadi/opauque-stellar/issues)** with a clear title (for example, `Abuse report:` or `Sanctions concern:`) and enough detail for us to investigate. Do not include sensitive personal data in public issues when a private advisory is more appropriate.

The reference wallet also surfaces an in-app summary at `/abuse-policy` (see `frontend/src/components/AbusePolicyPage.tsx`).

## Supported versions

Security fixes are applied to the latest code on the `main` branch. When we tag a release, notes appear on the [GitHub Releases](https://github.com/collinsadi/opauque-stellar/releases) page.

## Dependency security

Advisory response windows and the routine update-batching schedule are
defined in [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md#12-dependency-update-policy).

## Upgrade governance

Contract upgrade authority, process, and user-visible guarantees are documented in [docs/UPGRADE_GOVERNANCE.md](docs/UPGRADE_GOVERNANCE.md).

## Scope

- Soroban contracts in `contracts/`
- Reference frontend in `frontend/`
- Scanner WASM in `scanner/`
- Deployment manifests and CI verification scripts

Out of scope: third-party wallets, Stellar network consensus, and self-hosted forks unless they use official deployment credentials we operate.
