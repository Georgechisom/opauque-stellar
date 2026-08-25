# Add four PR-blocking CI checks: reproducible contract builds, license compliance, accessibility audit, and stale-issue automation

Closes #471, #470, #469, #472.

## Why

This repo has had no PR-blocking CI (see `.github/CONTRIBUTING.md` § 12/13 —
only a weekly, non-blocking `dependency-audit.yml` existed). Four separate
gaps were tracked as issues; this PR closes all four with new,
narrowly-scoped workflows rather than one broad "add CI" change, so each is
reviewable and revertible independently.

## What changed

### #471 — Reproducible contract build verification
- `docker/reproducible-build.Dockerfile`: a pinned, checksum-verified build
  image (Rust base pinned **by digest**, Stellar CLI and Node pinned by
  version with SHA-256 verification for both `amd64`/`arm64`).
- `.github/workflows/contracts-reproducible-build.yml`: builds the contracts
  workspace inside that image on every PR touching `contracts/**`, then runs
  `verify-deployment-manifest.ts --check-wasm` against
  `deployments/v1/{testnet,mainnet}.json` — **fails on any hash mismatch**.
- `docs/REPRODUCIBLE_BUILDS.md`: what's pinned and why, the release-manager
  reproduction procedure, and the version-bump procedure.

### #470 — License compliance for bundled WASM/circuits
- `scripts/third-party-notices-lib.ts` (+ thin `generate`/`verify` wrappers,
  new `npm run notices:generate` / `notices:verify`): scans Rust crates
  compiled into the contract/scanner WASM (`cargo metadata`) and npm
  dependencies bundled into the frontend build and the circuits toolchain
  (`npm ls`), classifies each license as permissive or requiring an explicit
  reviewed entry, and generates `THIRD_PARTY_NOTICES.md`.
- The scan surfaced that `circomlib`/`circomlibjs`/`snarkjs` and their
  transitive iden3 dependencies are GPL-3.0 — each now has an explicit,
  justified entry in `REVIEWED_NON_PERMISSIVE`. Also added `MPL-2.0` to the
  permissive allow list (both here and in `deny.toml`/`scanner/deny.toml`,
  which previously didn't list it) after finding two Rust crates
  (`colored`, `fastrlp`) using it.
- `scanner/deny.toml`: scanner is a standalone Cargo workspace with no prior
  `cargo-deny` config of its own.
- `.github/workflows/license-compliance.yml`: `cargo deny check licenses`
  (contracts + scanner) and `npm run notices:verify`, PR-blocking. **A new
  dependency with a non-permissive or unrecognized license fails CI** until
  a maintainer adds a reviewed entry.

### #469 — Stale issue/PR automation
- `.github/workflows/stale.yml` (`actions/stale`): issues stale at 60 days /
  closed 14 days later; PRs stale at 30 / closed 14 days later. `P0`/`P1`
  are always exempt; maintainers can exempt anything else via `no-stale` or
  `pinned`.
- Policy documented in `.github/CONTRIBUTING.md` § 14.

### #472 — Accessibility audit in CI
- `frontend/e2e/a11y.spec.ts` (`@axe-core/playwright`, added as a
  devDependency): audits the public, unauthenticated views (`/`, `/privacy`,
  `/terms`, `/disclaimer`, `/abuse-policy`, `/threat-model`, `/branding`)
  against WCAG 2.0/2.1 A/AA. **Fails on a critical/serious violation.**
- `frontend/e2e/a11y.allowlist.ts`: empty by default; entries require a
  `justification` for why a flagged rule is a false positive.
- `.github/workflows/accessibility-audit.yml`: builds the frontend with
  `vite build` directly (not `npm run build` — see note below) and
  `SKIP_FRONTEND_PREBUILD=1` (the audited routes never touch the
  dynamically-loaded scanner/circuit WASM, so no Rust toolchain is needed
  for this job), and uploads the full axe report as a build artifact
  regardless of outcome.
- The first real run caught genuine `serious`-impact `color-contrast`
  violations in the shared `Footer` and `LegalPageLayout` (link/copyright
  text at 60–70% opacity, and `text-slate-500`, against the dark background
  didn't clear 4.5:1). Fixed by bumping opacity/shade — see
  `frontend/src/components/Footer.tsx` and
  `frontend/src/components/LegalPageLayout.tsx`.

**Note:** `frontend`'s `npm run build` (= `tsc -b && vite build`) currently
fails on pre-existing type errors unrelated to this PR (`src/lib/
poolNoteBackup.ts`, `src/lib/rootFreshnessCheck.ts`, `src/pages/settings/
SecuritySettings.tsx`). That's a separate, pre-existing issue — out of scope
here — but it's why `accessibility-audit.yml` calls `vite build` directly
rather than the documented `npm run build`. Worth a maintainer's attention
regardless of this PR.

### Docs
- `.github/CONTRIBUTING.md`: new § 13 (CI overview table) and § 14 (stale
  policy); § 7.1 and § 7.7 cover the reproducible-build and notices
  workflows for contributors; the old "no PR-blocking CI" language in § 12
  is updated to reflect that these four checks now are.
- `README.md`, `deployments/README.md`: pointers to the new docs.

## Verification

All run locally end-to-end before opening this PR:

- `npx tsx scripts/generate-third-party-notices.ts` /
  `npx tsx scripts/verify-third-party-notices.ts` — clean (641 bundled
  dependencies scanned, zero unreviewed after adding the reviewed GPL-3.0
  iden3/circom entries and expanding the permissive allow list with
  `MPL-2.0`/`Zlib`/`Unlicense`/bare `BSD`).
- `cargo deny check licenses` — passes for both the root (contracts)
  workspace and `scanner/` (found and fixed: `scanner/Cargo.toml` was
  missing `license`/`publish = false`, and both `deny.toml`s were missing
  `MPL-2.0`/`Zlib` for two real transitive deps).
- `frontend`: `npx vite build` (`SKIP_FRONTEND_PREBUILD=1`) +
  `npm run test:a11y` — all 7 routes pass after the contrast fixes.
- `docker/reproducible-build.Dockerfile`: every download URL and checksum
  (Node, Stellar CLI, for both `amd64`/`arm64`) verified directly against
  upstream; the base image is pinned by the manifest-list digest fetched
  from Docker Hub's registry API. A full `docker build` was underway
  against this sandbox's Docker daemon when this PR was prepared (basic
  image pulls and container networking both confirmed working); re-confirm
  the full build on this PR's CI run before merging.

## Test plan

- [ ] `contracts-reproducible-build.yml` passes on this PR (no contract
      source changed, so hashes should match `deployments/v1/*.json`
      unchanged).
- [ ] `license-compliance.yml` passes.
- [ ] `accessibility-audit.yml` passes and uploads an `a11y-report` artifact.
- [ ] `stale.yml` — no PR-visible effect until its daily schedule fires;
      confirm via `workflow_dispatch` if needed.
