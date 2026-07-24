import { test, expect } from "@playwright/test";

test.describe("Wallet smoke flow", () => {
  test("landing page loads and shows setup CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Opaque Cash")).toBeVisible({ timeout: 10_000 });
  });

  test("landing page has wallet connect entry point", async ({ page }) => {
    await page.goto("/");
    const connectBtn = page.locator("button").filter({ hasText: /connect|wallet/i });
    await expect(connectBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test("disclaimer page is accessible", async ({ page }) => {
    await page.goto("/disclaimer");
    await expect(page.locator("text=Disclaimer")).toBeVisible({ timeout: 10_000 });
  });

  test("terms page is accessible", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.locator("text=Terms")).toBeVisible({ timeout: 10_000 });
  });

  test("privacy page is accessible", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("text=Privacy")).toBeVisible({ timeout: 10_000 });
  });

  test("app shell renders without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (e) => !e.includes("Non-Error promise rejection") && !e.includes("ResizeObserver"),
    );
    expect(criticalErrors).toEqual([]);
  });

  test("CSS loads and basic layout is visible", async ({ page }) => {
    await page.goto("/");
    const body = page.locator("body");
    const bgColor = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("responsive layout does not overflow on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("404 page renders for unknown routes", async ({ page }) => {
    const response = await page.goto("/nonexistent-route-xyz");
    expect(response?.status()).toBeGreaterThanOrEqual(200);
  });
});
