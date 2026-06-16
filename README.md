<div align="center">

# Opaque Stellar

Private XLM payments, association-set privacy pools, relayed withdrawals, and ZK reputation on Stellar.

[![CI](https://github.com/opaquecash/stellar/actions/workflows/ci.yml/badge.svg)](https://github.com/opaquecash/stellar/actions/workflows/ci.yml)
[![GPLv3 License](https://img.shields.io/badge/license-GPLv3-111827?labelColor=0b1020)](LICENSE)
[![Stellar Soroban](https://img.shields.io/badge/Stellar-Soroban-14b8a6?labelColor=0b1020)](https://developers.stellar.org/docs/build/smart-contracts)

[Wallet](frontend/) | [Technical overview](docs/technical-overview.md) | [ASP guide](docs/running-asp.md) | [Relayer guide](docs/running-relayer.md) | [Demo video](https://www.youtube.com/watch?v=REPLACE_WITH_DEMO_ID)

</div>

## Why Opaque Exists

Public ledgers make settlement verifiable, but they also make personal and business activity easy to map. A single public wallet can expose donations, payroll, supplier payments, savings behavior, and membership in private communities.

Opaque Stellar keeps the auditability of Stellar while removing the need to expose a user's main wallet in every flow. It does this with five protocol pieces that work together:

| Piece | Problem it solves |
| --- | --- |
| Stealth payments | A sender can pay a fresh one-time Stellar account derived from the recipient's public meta-address. The recipient scans and sweeps without publishing their main wallet. |
| Privacy pool | A user can deposit XLM into a commitment set, then withdraw later with a Groth16 proof that hides which deposit funded the withdrawal. |
| Association Set Provider | The ASP publishes the approved set root used by withdrawal proofs. In the MVP demo it approves all deposits, so it provides liveness and root publication, not selective screening. |
| Relayer market | A relayer submits the withdrawal transaction for the user, so the final withdrawal does not have to be sent from the user's connected wallet. |
| ZK reputation | A user can prove a credential or reputation trait on Soroban without linking it to the wallet that received or holds funds. |

Opaque is designed as a first of its kind Stellar-native privacy stack because it combines DKSAP stealth receiving, browser-side WASM scanning, Soroban Groth16 verification, an association-set privacy pool, and a stake-backed relayer market in one open protocol.

## What Works Today

Opaque is live on Stellar testnet for the MVP path.

| Surface | Status |
| --- | --- |
| Private payments | Testnet contracts and browser wallet are wired for register, send, scan, and sweep. |
| Privacy pool | Deposit, root publication, proof generation, partial withdrawal, and replay rejection are implemented. |
| ASP | A demo ASP is running and approving all testnet deposits for the MVP demo. |
| Relayer | A demo relayer is running for MVP relayed withdrawals at `https://g-stelar-relayer.opaque.cash`. |
| Reputation | V2 Groth16 reputation proofs verify through Soroban contracts. |
| CI/CD | GitHub Actions validate manifests, contracts, scanner WASM, circuits, frontend, ASP, relayer, and release artifacts. |

This is experimental software. Read [DISCLAIMER.md](DISCLAIMER.md) before using real funds.

## How The Flow Feels

1. A recipient initializes Opaque and publishes a stealth meta-address.
2. A sender pays XLM to a one-time account that only the recipient can derive.
3. The recipient scans announcements locally in the browser and sweeps funds.
4. For stronger withdrawal privacy, the user deposits into the privacy pool and waits for published roots.
5. The user withdraws with a zero-knowledge proof, optionally through the relayer market.
6. The relayer receives an encrypted payload, submits the Soroban withdrawal, and earns the escrowed fee if it completes the job.

Read more... [Technical overview](docs/technical-overview.md)

## Use Cases

| Use case | Why Opaque helps |
| --- | --- |
| Private creator payments | Fans can pay without linking the recipient's main wallet across every payment. |
| Payroll and contractor payouts | Workers can receive XLM without making their salary history easy to inspect. |
| DAO contributor rewards | Members can prove role or eligibility while separating payouts from public identity. |
| Consumer wallet privacy | Wallets can offer one-time receive accounts and pool withdrawals without custodial infrastructure. |
| Credential-gated access | Apps can verify reputation, eligibility, or attestations without learning the user's public wallet graph. |
| Compliance-aware privacy | Association sets let operators define allowed deposits while preserving withdrawal unlinkability. |

## Quick Start

Prerequisites: Node 20+, Rust, Stellar CLI, Freighter, and wasm-pack.

```bash
git clone https://github.com/opaquecash/stellar.git
cd stellar
npm ci
npm run build:scanner
npm run fetch:circuits

cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`, connect Freighter on Stellar testnet, and initialize Opaque keys.

The frontend reads contract IDs from [deployments/v1/testnet.json](deployments/v1/testnet.json). You do not need to redeploy contracts to try the testnet wallet.

Read more... [Frontend wallet](frontend/)

## Run The Protocol Services

The privacy pool and PSR verifier need roots, and relayed withdrawals need a public gateway. The repo ships these services.

| Service | Command | Guide |
| --- | --- | --- |
| ASP indexer | `cd asp && npm run indexer` | [Read more...](docs/running-asp.md) |
| Reputation publisher | `cd publisher && npm run publisher` | [Read more...](publisher/) |
| Relayer hub | `cd relayer && npm run hub` | [Read more...](docs/running-relayer.md) |
| Relayer node | `cd relayer && npm run relayer` | [Read more...](docs/running-relayer.md) |

For the MVP demo, a testnet ASP is already running with an approve-all policy, and a relayer is already running for relayed withdrawals at `https://g-stelar-relayer.opaque.cash`. Operators should still run their own services before relying on the system outside demo use.

## Repository Map

| Path | Purpose |
| --- | --- |
| [frontend/](frontend/) | React wallet for private receives, scans, sweeps, pool deposits, withdrawals, and reputation proofs. |
| [contracts/](contracts/) | Soroban contracts for registries, announcements, attestations, verifiers, privacy pool, and relayer registry. |
| [scanner/](scanner/) | Rust DKSAP scanner compiled to WASM for browser-side receive detection. |
| [circuits/](circuits/) | Circom Groth16 circuits, fixtures, and regression tests. |
| [asp/](asp/) | Association Set Provider and pool state root publisher. |
| [publisher/](publisher/) | Reputation leaf commitment collector and PSR Merkle-root publisher. |
| [relayer/](relayer/) | Relayer gateway, shared hub, node engine, registration helper, and market tests. |
| [deployments/](deployments/) | Versioned on-chain address book and manifest data. |
| [scripts/](scripts/) | TypeScript deploy, verification, artifact, and manifest tooling. |
| [docs/](docs/) | Operator guides, protocol internals, and security notes. |

## CI/CD

The repository uses GitHub Actions for CI and release gates:

| Workflow | What it checks |
| --- | --- |
| [CI](.github/workflows/ci.yml) | Manifest validation, supply-chain checks, scanner WASM, circuits, frontend build and tests, contracts, ASP, and relayer. |
| [Mainnet Release](.github/workflows/release.yml) | Release manifest checks, security audit register, contract artifacts, scanner, frontend, and deployment metadata. |

Read more... [CI/CD guide](docs/ci-cd.md)

## Stars Trend

[![Star History Chart](https://api.star-history.com/svg?repos=opaquecash/stellar&type=Date)](https://www.star-history.com/#opaquecash/stellar&Date)

## Security

Report vulnerabilities through [SECURITY.md](SECURITY.md). The browser key-storage threat model is documented in [docs/GHOST_THREAT_MODEL.md](docs/GHOST_THREAT_MODEL.md).

Mainnet use is blocked until the security register is signed off. Testnet deployments are for demonstration and integration testing.

## License

Opaque Stellar is licensed under [GPLv3](LICENSE).

<div align="center">

Built by [Collins Adi](https://github.com/collinsadi), creator of Auraroom, an anonymous groupchat system, and Safemind, an anonymous therapy system.

Every transaction deserves the right to be private.

</div>
