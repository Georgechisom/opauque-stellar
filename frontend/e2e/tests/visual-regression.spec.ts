import { test, expect, E2E_PUBLIC_KEY } from "../fixtures/wallet";
import { mockHorizonAccount, mockSorobanRpcNotRegistered } from "../fixtures/network";

/**
 * Visual regression for the main views (issue #460). Baselines live under
 * `e2e/tests/visual-regression.spec.ts-snapshots/` once generated — see
 * `frontend/e2e/README.md` for the update workflow.
 *
 * Determinism:
 * - Fixed viewport (set per-project in playwright.config.ts).
 * - `page.emulateMedia({ reducedMotion: "reduce" })` flips the app's own
 *   motion-preference resolution (frontend/src/hooks/usePrefersReducedMotion.ts)
 *   to "reduced", which sets `<html data-reduce-motion="true">` and switches
 *   framer-motion's `MotionConfig` to `reducedMotion: "always"` app-wide —
 *   more reliable than hand-disabling individual CSS animations.
 * - `disableAnimations()` additionally freezes any remaining CSS
 *   animations/transitions (e.g. the connect-flow spinner) before a
 *   screenshot; `toHaveScreenshot`'s own `animations: "disabled"` (set in
 *   playwright.config.ts, if configured) stops Web Animations API output too.
 * - Wallet/network state is mocked (same fixtures as the functional suite)
 *   so dynamic values (addresses, balances) are fixed, not live testnet data.
 */

async function disableAnimations(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
}

test.describe("Visual regression: main views", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("landing page", async ({ page }) => {
    await page.goto("/");
    await disableAnimations(page);
    await expect(page.getByRole("heading", { name: "Privacy protocol on Stellar." })).toBeVisible();
    await expect(page).toHaveScreenshot("landing-page.png", { fullPage: true });
  });

  test("dashboard (registered wallet)", async ({ registeredWalletPage: page }) => {
    await mockHorizonAccount(page, E2E_PUBLIC_KEY, "50.0000000");
    await mockSorobanRpcNotRegistered(page);
    await page.goto("/app");
    await page.getByRole("button", { name: /connect wallet & initialize/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
    await disableAnimations(page);
    await expect(page).toHaveScreenshot("dashboard-view.png", { fullPage: true });
  });

  test("send view (registered wallet)", async ({ registeredWalletPage: page }) => {
    await mockHorizonAccount(page, E2E_PUBLIC_KEY, "50.0000000");
    await mockSorobanRpcNotRegistered(page);
    await page.goto("/app");
    await page.getByRole("button", { name: /connect wallet & initialize/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("heading", { name: "Send XLM" })).toBeVisible();
    await disableAnimations(page);
    await expect(page).toHaveScreenshot("send-view.png", { fullPage: true });
  });
});
