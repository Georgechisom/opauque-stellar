#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Cross-browser test matrix for the wallet frontend.
#
# Runs the unit suite and wallet smoke flow across Chromium, Firefox, and WebKit.
# Engine-specific failures are tracked by Playwright project name in the HTML
# report.
#
# Prerequisites:
#   cd frontend && npm install && npx playwright install
#
# Usage:
#   ./scripts/cross-browser-test.sh            # run all three engines
#   ./scripts/cross-browser-test.sh --chromium  # Chromium only
#   ./scripts/cross-browser-test.sh --firefox   # Firefox only
#   ./scripts/cross-browser-test.sh --webkit    # WebKit only
#
# Results: frontend/playwright-report/
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
REPORT_DIR="$FRONTEND_DIR/playwright-report"

cd "$FRONTEND_DIR"

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "  Step 1: Unit tests (vitest)"
echo "══════════════════════════════════════════════════════════════════"
npm test

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "  Step 2: Cross-browser smoke tests (Playwright)"
echo "══════════════════════════════════════════════════════════════════"

MODE="${1:---all}"

case "$MODE" in
  --chromium)
    npx playwright test --project=chromium
    ;;
  --firefox)
    npx playwright test --project=firefox
    ;;
  --webkit)
    npx playwright test --project=webkit
    ;;
  --all)
    npx playwright test
    ;;
  *)
    echo "Usage: $0 [--chromium | --firefox | --webkit | --all]" >&2
    exit 1
    ;;
esac

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo "  Cross-browser matrix complete."
echo "  HTML report: $REPORT_DIR/index.html"
echo "══════════════════════════════════════════════════════════════════"
