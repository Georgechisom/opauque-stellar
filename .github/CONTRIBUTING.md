# Contributing to Opaque (Stellar)

Thanks for contributing. Opaque handles **private payments**, **on-chain ZK
reputation**, and a **shielded privacy pool**, so correctness and reproducibility
are not optional. This guide describes the exact bar every change must clear, how
the repository is laid out, and the workflow we expect. Running the checks below
locally before you push is the fastest way to keep your PR mergeable.

> **Golden rule:** no change may break `main`. Every commit on `main` must build,
> pass all tests, lint clean, and keep the deployment and artifact manifests
> verifiable.

We work in good faith. Be respectful in issues and reviews, assume the best of
other contributors, keep discussion technical, and prefer small, well-explained
changes over large unexplained ones.

---

## 1. How the system fits together

Before changing anything, it helps to know the moving parts and how they depend on
each other:

- **Contracts** (`contracts/`) hold the on-chain state: stealth announcements, the
  schema and attestation registries, the Groth16 and reputation verifiers, and the
  privacy pool.
- **Scanner** (`scanner/`) is the DKSAP stealth-address scanner, compiled to WASM
  and consumed by the frontend and the SDK. It reads the contract event ABI, so the
  two are tightly coupled.
- **Circuits** (`circuits/`) are the Circom Groth16 circuits whose verifying keys
  are bound into the on-chain verifier and the artifact manifest.
- **Frontend** (`frontend/`), **SDK** (`sdk/`), **relayer** (`relayer/`), and **ASP**
  service (`asp/`) are the clients and services built on top of the contracts.
- **Deployments** (`deployments/`) and **artifacts** (`artifacts/`) are the source of
  truth for deployed addresses and pinned binary hashes. Many checks exist purely to
  keep these honest.

The recurring theme: the scanner, circuits, and contracts must stay in lockstep, and
every binary that ships (scanner WASM, circuit keys) is hash-pinned.

---

## 2. Project layout

| Path | What it is | Toolchain |
|:-----|:-----------|:----------|
| `contracts/` | Soroban smart contracts and shared crates (Cargo workspace). The deployable set is declared in `soroban.toml`. | Rust + Stellar CLI |
| `scanner/` | DKSAP stealth-address scanner compiled to WASM | Rust + wasm-pack |
| `circuits/` | Circom Groth16 circuits and regression fixtures | Node + circom + snarkjs |
| `frontend/` | React/TypeScript reference wallet UI | Node + Vite |
| `sdk/` | TypeScript client SDK, published as `@opaquecash/stellar` | Node + tsup |
| `relayer/` | Relayer market service (`@opaquecash/relayer`) | Node |
| `asp/` | Association Set Provider service (`@opaquecash/asp`) | Node |
| `scripts/` | TypeScript tooling (deploy, verify, artifacts), run via `tsx` | Node + tsx |
| `deployments/` | Canonical contract manifests (source of truth) | JSON |
| `artifacts/` | Pinned artifact manifest (scanner WASM and circuit hashes) | JSON |

---

## 3. Prerequisites

- [Rust](https://rustup.rs/) (stable) with both WASM targets:
  ```bash
  rustup target add wasm32-unknown-unknown wasm32v1-none
  rustup component add rustfmt clippy
  ```
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup).
  You can install a pinned version via `scripts/install-stellar-cli.sh` for a
  matching toolchain.
- [Node.js](https://nodejs.org/) 20 or newer.
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) for the scanner.
- `cargo-audit` and `cargo-deny` for supply-chain checks:
  ```bash
  cargo install cargo-audit cargo-deny --locked
  ```
- For circuit work only: [circom](https://docs.circom.io/) and `snarkjs`. The
  regression job is heavy, so most contributors will not need a local circom.

---

## 4. First-time setup

Each Node workspace pins its dependencies with a lockfile and must be installed with
`npm ci` (not `npm install`) so you match the lockfile exactly.

```bash
git clone https://github.com/collinsadi/opauque-stellar.git
cd opauque-stellar

npm ci                       # root tooling (tsx, typescript)
( cd frontend && npm ci )
( cd sdk && npm ci )
( cd relayer && npm ci )
( cd asp && npm ci )
( cd circuits && npm ci )    # only needed for circuit work

cp .env.example .env         # set STELLAR_NETWORK and STELLAR_DEPLOYER

npm run build:scanner        # produces the WASM the frontend/SDK consume
```

A good smoke test that your environment is sane:

```bash
cargo test --workspace --locked
npm run verify:deployment
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict
```

---

## 5. Branching and commits

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`,
  or `chore/<short-name>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for PR commits:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Example:
  `fix(scanner): reject non-compressed ephemeral keys`.
- Keep PRs focused and small. One logical change per PR makes review and rollback
  easy.
- Write the "why" in the body, not just the "what". Link the issue you are closing.
- **Never** commit secrets, raw seeds (`S...`), `.env` files, or large build
  artifacts (zkeys, WASM blobs, `target/`). These are gitignored. Keep it that way.

> **Hash-pinned sources have no free changes.** The scanner WASM and the circuit
> keys are pinned by hash in `artifacts/manifest.json`. A rebuild is not guaranteed
> to be byte-identical, so even a comment-only edit to `scanner/` source can change
> the produced binary and fail the artifact check. Do not push cosmetic or "refresh"
> commits to hash-pinned sources. If you genuinely change that code, update the
> manifest in the same PR (see Section 7.2).

---

## 6. The required checks (must pass before pushing)

Run the checks relevant to your change locally before you push.

### 6a. Contracts (Rust workspace)

```bash
cargo fmt --all -- --check                              # formatting
cargo clippy --workspace --all-targets -- -D warnings   # zero warnings
cargo test --workspace --locked                         # unit + property tests
stellar contract build                                  # release WASM builds
```

- **Warnings are errors.** Clippy runs with `-D warnings`. Do not introduce new ones.
- If you must silence a lint, do it narrowly (`#[allow(...)]` on the item) with a
  comment explaining why. Never broaden it to the crate unless a macro expansion
  genuinely forces it (for example `#[contractimpl]` argument counts).
- **Do not delete or weaken a test to make the checks pass.** If a test encodes an
  expectation that no longer matches intended behavior, either fix the code or mark
  the test `#[ignore = "<reason + tracking note>"]` and call it out in the PR
  description. Ignored tests must be justified.

### 6b. Scanner (WASM)

```bash
npm run build:scanner
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict
```

The scanner WASM hash is pinned in `artifacts/manifest.json`. If you change scanner
code, rebuild and update the manifest in the **same** PR (see Section 7.2).

### 6c. Circuits

```bash
npm run test:circuits     # deterministic regression fixtures
```

Circuit logic changes require regenerating fixtures and updating the artifact
manifest and verifying-key binding. Large artifacts are fetched from releases, never
committed.

### 6d. Frontend

```bash
cd frontend
npm ci
npm run lint              # ESLint, zero errors
npx tsc -b --noEmit       # typecheck
npm run build             # production build
npx vitest run            # unit tests
```

### 6e. SDK

Run from `sdk/`:

```bash
cd sdk
npm ci
npm run lint
npm run typecheck
npm run build
npm run check:exports     # publint + are-the-types-wrong
npm test
```

### 6f. Services (relayer and ASP)

```bash
( cd relayer && npm ci && npm run typecheck && npm test )
( cd asp && npm ci && npm run typecheck && npm test )
```

### 6g. Supply chain and manifests

```bash
npm run verify:deployment           # manifest schema + no legacy Solana/devnet refs
cargo audit
cargo deny check
```

---

## 7. Component-specific guidance

### 7.1 Changing contracts

- The Soroban event ABI (topics and versions) is consumed by the scanner. **Do not
  change event shapes** without updating the scanner and bumping the event version.
- Storage key derivation is consensus-critical. Changing it is a breaking change and
  requires a redeploy plus a manifest update.
- After any contract change that affects bytecode, rebuild and update the WASM hashes
  in the relevant `deployments/v1/<network>.json` manifest.
- `attestation-engine-v2`, `privacy-pool`, `reputation-verifier`, and
  `relayer-registry` are meant to be administered through the
  `multisig-admin` contract (see
  [docs/MULTISIG_ADMIN.md](../docs/MULTISIG_ADMIN.md)), not a single key. A
  new admin-gated function on any of them should follow the same
  `caller.require_auth()` + `caller == config.admin` pattern the existing
  ones use, so it works unchanged whether `admin` is a single account or a
  deployed multisig.

### 7.2 Changing the scanner

The scanner is the most reproducibility-sensitive component because its WASM is
hash-pinned. When you make a real change:

```bash
npm run build:scanner                 # rebuild the WASM
npm run update:manifest-wasm          # refresh the pinned hashes in artifacts/manifest.json
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict   # confirm it passes
```

Commit the regenerated `artifacts/manifest.json` alongside the source change in the
same PR. If a change to scanner code is not meant to alter behavior, confirm the
verify step still passes before you push, because the build may not be byte-stable.

### 7.3 Changing circuits

**Any PR that adds or modifies a `.circom` file must complete
[`docs/CIRCUIT_SOUNDNESS_CHECKLIST.md`](../docs/CIRCUIT_SOUNDNESS_CHECKLIST.md)
and paste the filled-in checklist into the PR description before requesting
review** (see the Pull Request checklist in Section 9). This is required in
addition to, not instead of, the checks below — the checklist catches
under-constrained signals, missing range checks, and public-input-binding
gaps that compiling and passing the existing tests will not surface.

Before building, confirm your local toolchain matches the pinned circom /
snarkjs / Node versions:

```bash
( cd circuits && npm run check:toolchain )
```

This fails fast with the expected-vs-actual versions and an install
pointer if your `circom`, `snarkjs`, or Node major version doesn't match
[`circuits/TOOLCHAIN.json`](../circuits/TOOLCHAIN.json) — a circuit
compiled with the wrong `circom`/`snarkjs` version can silently produce a
build that is not byte-compatible with the pinned artifacts even when every
test still passes locally.

Then regenerate fixtures and re-verify the artifact manifest:

```bash
( cd circuits && npm run fixtures:generate )
npm run test:circuits
npm run verify:artifacts
```

Verifying-key changes must be reflected in both the artifact manifest and the
on-chain verifier binding.

### 7.4 Frontend

The frontend consumes the scanner WASM and the deployment manifests through a
prebuild step (`prepare-frontend-artifacts`). If you changed the scanner or a
manifest, rebuild the scanner first so the frontend picks up the new artifact.

### 7.5 SDK

The SDK is published to npm as `@opaquecash/stellar`. Public API changes need a
changeset (`npm run changeset`) and must keep `npm run check:exports` green so the
published types and entry points stay correct.

### 7.6 Services

The relayer market (`relayer/`) and the Association Set Provider (`asp/`) are Node
services. Keep `typecheck` and `test` green; both have smoke scripts (for example
`npm run smoke:market` in the relayer) for manual end-to-end checks.

Testnet operations for these services (plus the reputation publisher) are held to the
SLOs in [`docs/testnet-slos.md`](../docs/testnet-slos.md), measured by `npm run
slo:report`. A change that materially affects publish/completion latency should call
that out in the PR description.

---

## 8. Deploying (maintainers)

Deployment is a single command driven entirely by the root `.env`:

```bash
cp .env.example .env                # set STELLAR_NETWORK + STELLAR_DEPLOYER
npm run deploy:testnet              # build + deploy + update manifest
npm run deploy:testnet -- --dry-run # preview (no broadcast)
```

- **Mainnet requires audit signoff.** `npm run deploy:mainnet` runs the
  `verify-security-audit` gate. Do not bypass it with `--force` for real deploys.
- Always commit the updated manifest, then verify:
  ```bash
  npx tsx scripts/verify-deployment-manifest.ts --network <net> --strict --check-wasm
  ```

---

## 9. Pull request process

1. Open a PR against `main` and fill in the template (`.github/pull_request_template.md`).
2. Confirm the checklist below.
3. `@collinsadi` reviews everything; the consensus-critical paths (`contracts/`,
   `scanner/`, `circuits/`, `deployments/`, `scripts/`) call for extra care.
4. PRs are squash-merged to keep `main` history linear.

### Checklist

- [ ] All Section 6 checks relevant to your change pass locally.
- [ ] No secrets, `.env`, or build artifacts added.
- [ ] Tests added or updated for new behavior (no deleted or weakened tests without
      justification).
- [ ] Manifests and artifact hashes updated if contracts, scanner, or circuits
      changed.
- [ ] Event ABI or storage layout changes are matched by a scanner update and a
      version bump.
- [ ] Conventional-commit messages, and a PR description that explains the "why".
- [ ] Docs or README updated if behavior or commands changed.
- [ ] **If this PR touches a `.circom` file:** the filled-in
      [`docs/CIRCUIT_SOUNDNESS_CHECKLIST.md`](../docs/CIRCUIT_SOUNDNESS_CHECKLIST.md)
      is pasted into this PR's description.

---

## 10. Reporting bugs and proposing changes

- **Bugs:** open a GitHub issue with steps to reproduce, the affected component and
  commit or deployment, expected versus actual behavior, and any logs. A failing
  test or minimal repro is the fastest path to a fix.
- **Features and design changes:** open an issue describing the problem and your
  proposed approach before writing a large PR, especially for anything touching the
  event ABI, storage layout, circuits, or the privacy pool. Aligning early avoids
  rework.
- **Security issues:** do not use public issues. Follow Section 11.

---

## 11. Security

Do **not** open public issues for vulnerabilities. Follow the disclosure process in
[`SECURITY.md`](SECURITY.md). See [`DISCLAIMER.md`](DISCLAIMER.md) for the
experimental status and privacy limitations of this software.

---

## 12. Dependency update policy

Dependencies (Rust crates, npm packages in `/` and `frontend/`, GitHub Actions)
are kept current on a stated cadence instead of ad hoc, so security patches
don't lag and upgrades don't pile up into risky big-bang bumps.

### Response windows by advisory severity

| Severity | Response window | Notes |
|----------|-----------------|-------|
| Critical | Patch within 24–48h of advisory publication | Out-of-band PR; does not wait for the next routine batch |
| High | Patch within 7 days | Out-of-band PR if the next routine batch is more than 7 days away |
| Medium | Patch within 30 days | Bundled into the next routine batch unless actively exploited |
| Low / informational | Next routine batch | No dedicated SLA |

There is currently no PR-blocking CI in this repository — `.github/workflows/`
has no jobs prior to this policy, so nothing enforces these windows at merge
time yet. [`dependency-audit.yml`](workflows/dependency-audit.yml) is the
first automated coverage: a weekly scheduled job (non-PR-blocking) that runs
`cargo audit` / `cargo deny check` and `npm audit` across the root and
`frontend/` workspaces, so an advisory published against an already-merged
dependency is still caught within the windows above instead of going
unnoticed indefinitely. Wiring these checks into PR-blocking CI is a natural
follow-up once such CI exists, but is out of scope here.

[`dependabot.yml`](dependabot.yml) opens security-update pull requests
immediately on advisory publication, independent of the batching schedule
below.

### Rust WASM build chain (`scanner/`, compiled with wasm-pack)

The `scanner/` crate is **not** part of the contracts workspace, so its
dependency tree is monitored separately (#486). The
[`dependency-audit.yml`](workflows/dependency-audit.yml) `scanner-audit` job
runs `cargo audit` **on every pull request** (PR-blocking) as well as on the
weekly schedule, so a vulnerable build dependency cannot reach `main`
unnoticed.

- **wasm-bindgen advisories are explicitly tracked.** A dedicated step in the
  `scanner-audit` job checks `wasm-bindgen` and its direct macro/backend crates
  and fails the PR if any advisory is present, so they are never buried in a
  broader audit pass.
- **Triaged within SLA.** Advisories surfaced by `scanner-audit` follow the
  same response windows in the table above (Critical 24–48h, High 7 days, etc.).
  Because the job is PR-blocking, a Critical/High finding must be resolved or
  have an accepted `cargo audit --ignore` exception (recorded in
  `scanner/deny.toml` or an ignore file with a justification) before merge.
- **Local equivalent.** Maintainers can reproduce the check before pushing:
  `cd scanner && cargo install cargo-audit --locked && cargo audit`.

The full supply-chain policy — hash-pinning of scanner WASM and circuit
artifacts, reproducible builds, and the manifest verification gate — is
documented in [`docs/supply-chain-policy.md`](docs/supply-chain-policy.md).

### Batching strategy per workspace

Routine (non-security) version updates are batched monthly per workspace via
`dependabot.yml`, grouped into a single PR per ecosystem where possible:

- **`cargo` (workspace root)** — monthly, minor/patch updates grouped into
  one PR. `soroban-sdk` is excluded from grouping and always opens its own
  PR: it's pinned to an exact version (`soroban-sdk = "=25.3.1"` in
  `Cargo.toml`) because a bump can change contract ABI/event behavior (see
  § 7.1), so it needs deliberate review rather than a silent batch bump.
- **`npm` (root, `frontend/`)** — monthly, minor/patch updates grouped per
  workspace into one PR each.
- **`github-actions`** — monthly.

Every dependency-update PR, batched or out-of-band, must still pass the full
Section 6 check suite before merge — batching reduces PR *count*, not review
rigor.
