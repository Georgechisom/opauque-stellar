#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Mutation testing for the privacy-pool and groth16-verifier contract crates.
#
# Requires: cargo-mutants  (cargo install cargo-mutants)
#
# Usage:
#   ./scripts/mutation-test.sh              # run both crates (default)
#   ./scripts/mutation-test.sh --pool       # privacy-pool only
#   ./scripts/mutation-test.sh --verifier   # groth16-verifier only
#
# The script produces a results report under target/mutation-testing/ and is
# designed to be repeatable in CI or locally.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$REPO_ROOT/target/mutation-testing"
mkdir -p "$RESULTS_DIR"

POOL_CRATE="privacy-pool"
VERIFIER_CRATE="groth16-verifier"

run_mutation() {
  local crate="$1"
  local label="$2"
  echo ""
  echo "══════════════════════════════════════════════════════════════════"
  echo "  Mutation testing: $label ($crate)"
  echo "══════════════════════════════════════════════════════════════════"
  cargo mutants \
    --package "$crate" \
    --timeout 120 \
    --output "$RESULTS_DIR/${crate}" \
    "$@"
  echo ""
  echo "  Results: $RESULTS_DIR/${crate}/report.md"
  echo ""
}

MODE="${1:---all}"

case "$MODE" in
  --pool)
    run_mutation "$POOL_CRATE" "privacy-pool"
    ;;
  --verifier)
    run_mutation "$VERIFIER_CRATE" "groth16-verifier"
    ;;
  --all)
    run_mutation "$POOL_CRATE" "privacy-pool"
    run_mutation "$VERIFIER_CRATE" "groth16-verifier"
    ;;
  *)
    echo "Usage: $0 [--pool | --verifier | --all]" >&2
    exit 1
    ;;
esac

echo "══════════════════════════════════════════════════════════════════"
echo "  Mutation testing complete. Reports in: $RESULTS_DIR"
echo "══════════════════════════════════════════════════════════════════"
