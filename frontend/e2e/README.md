# End-to-End & Visual Regression Tests

Playwright suite covering the app shell (`wallet-smoke.spec.ts`), core wallet
flows (issue #459), and visual regression baselines for the main views
(issue #460).

## Running

```bash
cd frontend
npx playwright install --with-deps chromium   # first time only
npm run test:e2e:chromium
```

`npm run test:e2e:chromium` (or `test:e2e` for all three configured browsers)
builds and serves the app via `vite preview` on port 4173 automatically (see
`playwright.config.ts`) and tears it down after the run.

## What's covered

| File | Covers |
|---|---|
| `wallet-smoke.spec.ts` | App-shell smoke checks: landing page, legal pages, no console errors, responsive layout, 404 fallback |
| `tests/wallet-connect.spec.ts` | Connect (mocked Freighter) → registration wizard for a fresh account → key derivation → on-chain register attempt |
| `tests/dashboard-and-flows.spec.ts` | Dashboard cards/nav, Send form validation, Receive view, seeded transaction history |
| `tests/visual-regression.spec.ts` | Screenshot baselines: landing page, dashboard, send view |

## How the wallet is mocked

The real Freighter browser extension isn't installed in a headless Playwright
browser, and `@stellar/freighter-api` talks to it over an extension-only
messaging channel that doesn't exist in that environment. Rather than
reverse-engineering that protocol, `frontend/src/context/StellarWalletProviders.tsx`
has a small, clearly-marked **test harness escape hatch**: if
`window.__OPAQUE_E2E_WALLET__` is set, `connect()` / `signTransaction()` /
`signMessage()` use it instead of the real extension calls. It is `undefined`
for every real user — only `frontend/e2e/fixtures/wallet.ts` sets it, via
`page.addInitScript()` before the app's own scripts run.

Similarly, confirming "is this wallet already registered on-chain" for real
requires a full Soroban `getLedgerEntries` + contract-`resolve` round trip.
`frontend/src/lib/registry.ts` has the same pattern: if
`window.__OPAQUE_E2E_REGISTERED_META__` is set, `isRegistered()`
short-circuits to `true` without a network call. Tests that need to land on
the Dashboard/Send/Receive/History views directly (rather than re-running
the full registration wizard every time) use the `registeredWalletPage`
fixture, which sets this.

Horizon (account balance) calls are mocked at the network layer instead
(`frontend/e2e/fixtures/network.ts`, via `page.route`), since Horizon's
plain REST/JSON responses are straightforward to fake accurately.

### Known scope boundary: on-chain transaction success

`wallet-connect.spec.ts` and `dashboard-and-flows.spec.ts` deliberately stop
at "submits a real signed transaction to Soroban RPC and handles the
response" rather than mocking a fully successful `simulateTransaction` →
`sendTransaction` → `getTransaction` round trip. Soroban's simulate/assemble
response format (`transactionData`, resource footprints, auth entries) is
tightly coupled to `@stellar/stellar-sdk`'s internal parsing and would be
fragile to hand-mock reliably; the RPC mock in these suites intentionally
returns clean JSON-RPC errors for those calls instead. What's verified is
the full UI flow — form validation, key derivation, transaction building,
signing via the wallet harness — and that failures are surfaced to the user
rather than crashing the app. If a future contributor wants full
happy-path on-chain simulation, consider running against a local Stellar
quickstart container (see the [testnet faucet guide](../../docs/testnet-faucet-guide.md#futurenet-and-local-networks))
instead of mocking the RPC wire format.

## Updating visual baselines

Baselines are stored as PNGs next to the spec
(`e2e/tests/visual-regression.spec.ts-snapshots/`) and are committed to the
repo. When a visual change is intentional:

```bash
cd frontend
npm run test:e2e:update
```

This runs only the `chromium` project with `--update-snapshots`, matching the
committed baseline filenames (`*-chromium-*.png`). Review the diffed/updated
PNGs in your git diff before committing — a snapshot update should correspond
to a real, reviewed UI change, not be run reflexively to make CI pass.
Baselines are platform/browser-render sensitive; generate them with the same
Chromium version Playwright installs locally (`npx playwright --version`) to
match what CI uses.

## CI

Wire `npm run test:e2e:chromium` into CI on PRs that touch `frontend/src` or
`frontend/e2e`, after `npx playwright install --with-deps chromium`. Cache
the Playwright browser binaries between runs to keep this fast — see
[Playwright's CI docs](https://playwright.dev/docs/ci) for provider-specific
examples.
