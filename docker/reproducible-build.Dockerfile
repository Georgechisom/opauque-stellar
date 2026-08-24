# Pinned reproducible build environment for the Soroban contracts workspace (#471).
#
# Every tool version in this image is pinned and checksum-verified so that
# `stellar contract build` produces the same WASM bytes on any host that runs
# it — a laptop, a CI runner, or a release manager's machine. See
# docs/REPRODUCIBLE_BUILDS.md for how this image is used and how to bump it.
#
# Base image is pinned by digest (not just tag) so a Docker Hub retag can
# never silently change the toolchain underneath this build.
FROM rust:1.85-slim-bookworm@sha256:9f841bbe9e7d8e37ceb96ed907265a3a0df7f44e3737d0b100e7907a679acb36

# Bump together and re-verify: docs/REPRODUCIBLE_BUILDS.md § "Bumping pinned versions".
ARG STELLAR_CLI_VERSION=26.1.0
ARG STELLAR_CLI_SHA256_AMD64=e18d5a7629102e1ccc07241acbcbebfc05b1c02476ce7d3204ba2d7418be5c0c
ARG STELLAR_CLI_SHA256_ARM64=6e57c76df3a130bd0112cd31407137bd915883971ea8b1c3bf76c613d361910b
ARG NODE_VERSION=20.18.1
ARG NODE_SHA256_AMD64=c6fa75c841cbffac851678a472f2a5bd612fff8308ef39236190e1f8dbb0e567
ARG NODE_SHA256_ARM64=44d1ffc5905c005ace4515ca6f8c090c4c7cfce3a9a67df0dba35c727590b8f6

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js — needed to run the TypeScript manifest-verification scripts against
# the WASM this image produces. Downloaded directly (no nodesource script) and
# checksum-verified against the value recorded above.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) nodeArch="linux-x64"; nodeSha="${NODE_SHA256_AMD64}" ;; \
      arm64) nodeArch="linux-arm64"; nodeSha="${NODE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${nodeArch}.tar.xz"; \
    echo "${nodeSha}  node-v${NODE_VERSION}-${nodeArch}.tar.xz" | sha256sum -c -; \
    tar -xJf "node-v${NODE_VERSION}-${nodeArch}.tar.xz" -C /usr/local --strip-components=1; \
    rm "node-v${NODE_VERSION}-${nodeArch}.tar.xz"; \
    node --version && npm --version

# Rust WASM targets used by `stellar contract build` (see .github/CONTRIBUTING.md § 3).
RUN rustup target add wasm32v1-none wasm32-unknown-unknown \
    && rustup component add rustfmt clippy

# Stellar CLI — pinned to the same default version as scripts/install-stellar-cli.sh,
# checksum-verified against the value recorded above (upstream does not publish a
# checksums file, so this hash was captured from the release asset directly).
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) cliTarget="x86_64-unknown-linux-gnu"; cliSha="${STELLAR_CLI_SHA256_AMD64}" ;; \
      arm64) cliTarget="aarch64-unknown-linux-gnu"; cliSha="${STELLAR_CLI_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    archive="stellar-cli-${STELLAR_CLI_VERSION}-${cliTarget}.tar.gz"; \
    curl -fsSLO "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/${archive}"; \
    echo "${cliSha}  ${archive}" | sha256sum -c -; \
    tar -xzf "$archive"; \
    install -m 0755 stellar /usr/local/bin/stellar; \
    rm -f "$archive" stellar; \
    stellar --version

WORKDIR /workspace
