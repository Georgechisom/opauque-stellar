# Reproducible contract builds

`stellar contract build` compiles every crate in the Cargo workspace to
`wasm32v1-none` release WASM. The resulting bytes are recorded as `wasmHash`
in `deployments/v1/<network>.json` — they are what the network actually runs,
and they are what auditors sign off on. If two different machines produce
different bytes for the same source tree, the pinned hash stops meaning
anything.

To keep that from drifting silently, contract builds are pinned to a
versioned, checksum-verified Docker image
([`docker/reproducible-build.Dockerfile`](../docker/reproducible-build.Dockerfile))
instead of "whatever Rust/Node/Stellar CLI happens to be on this machine or
runner." CI builds every contract inside that image on every PR that touches
the contracts workspace and fails if the resulting WASM hash doesn't match
the manifest ([`.github/workflows/contracts-reproducible-build.yml`](../.github/workflows/contracts-reproducible-build.yml)).

## What's pinned

| Tool | Pin | Why |
|:-----|:----|:----|
| Base image | `rust:1.85-slim-bookworm` pinned **by digest**, not just tag | A tag can be silently repointed; a digest can't. |
| Stellar CLI | Exact release version, tarball SHA-256 verified at build time | Matches the default in `scripts/install-stellar-cli.sh`. Upstream doesn't publish a checksums file, so the pinned hash was captured from the release asset itself — re-verify it when bumping (see below). |
| Node.js | Exact version, tarball SHA-256 verified against the official `SHASUMS256.txt` | Used to run `scripts/verify-deployment-manifest.ts` against the built WASM inside the same container. |
| Rust WASM targets | `wasm32v1-none`, `wasm32-unknown-unknown` | Same targets contributors install per `.github/CONTRIBUTING.md` § 3. |

## What the CI job does

`.github/workflows/contracts-reproducible-build.yml` runs on every PR that
touches `contracts/**`, `Cargo.toml`, `Cargo.lock`, `soroban.toml`,
`deployments/v1/**`, or the pinned Dockerfile itself:

1. Builds `docker/reproducible-build.Dockerfile`.
2. Runs `stellar contract build` inside that image, against the PR's
   checkout.
3. Runs `npm run verify:deployment:strict -- --check-wasm --network testnet`
   and the same for `mainnet`, inside the same container, which hashes every
   built `.wasm` file and compares it against `deployments/v1/<network>.json`.
4. **Fails the job on any mismatch.**

A mismatch means one of two things: the contract source changed and the
manifest wasn't updated (expected — update it, see § 7.1 of
`.github/CONTRIBUTING.md`), or the build isn't reproducible on the pinned
image even though the source didn't meaningfully change (not expected —
that's the failure mode this job exists to catch, and it should be treated as
a release-blocking bug, not silenced).

## For release managers: reproducing a deployed build locally

Before signing off on a mainnet deployment, reproduce it from a clean
checkout using the exact same image CI uses:

```bash
git checkout <release-tag-or-commit>

docker build -f docker/reproducible-build.Dockerfile -t opaque-contracts-build .

docker run --rm -v "$PWD:/workspace" -w /workspace opaque-contracts-build \
  bash -lc "npm ci && stellar contract build && \
    npm run verify:deployment:strict -- --check-wasm --network mainnet"
```

If this passes, the WASM bytes on-chain are byte-identical to what this
source tree produces on the pinned toolchain — that's the reproducibility
guarantee. If it fails with a hash mismatch, do not sign off; escalate before
the release proceeds.

## Bumping pinned versions

Bump the Stellar CLI, Node, or base image only as a deliberate, reviewed
change — not incidentally:

1. Update the version `ARG` in `docker/reproducible-build.Dockerfile`.
2. Recompute the checksum(s):
   - Stellar CLI: download the release tarball for each supported
     architecture and run `sha256sum` on it (upstream has no published
     checksums file to diff against, so this pin *is* the source of truth).
   - Node: copy the matching line out of
     `https://nodejs.org/dist/v<version>/SHASUMS256.txt`.
   - Base image: `docker manifest inspect rust:<tag> | ...` (or `docker
     buildx imagetools inspect rust:<tag>`) and take the manifest-list digest,
     so the pin still resolves correctly on both `amd64` and `arm64`.
3. Rebuild locally and re-run `stellar contract build` — a toolchain bump is
   expected to change WASM bytes, so refresh `deployments/v1/*.json` via
   `npm run update:manifest-wasm`-style tooling (see § 7.1/7.2 of
   `.github/CONTRIBUTING.md`) in the **same PR** as the bump.
4. Call out the bump explicitly in the PR description — it changes what
   "reproducible" means for every future build, so it needs deliberate
   review, not a routine dependency bump.
