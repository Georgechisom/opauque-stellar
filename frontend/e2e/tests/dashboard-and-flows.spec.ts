import { test, expect, E2E_PUBLIC_KEY, FAKE_META_ADDRESS_HEX } from "../fixtures/wallet";
import { mockHorizonAccount, mockSorobanRpcNotRegistered } from "../fixtures/network";

/**
 * Core wallet flows once a wallet is already registered (issue #459):
 * dashboard navigation, send-form validation, receive-address display, and
 * seeded transaction history. Uses `registeredWalletPage`, which short-
 * circuits the on-chain registration check (see fixtures/wallet.ts) so
 * these tests exercise the destination views directly instead of re-running
 * the full registration wizard every time.
 */
test.describe("Dashboard, send, receive, history (registered wallet)", () => {
  test.beforeEach(async ({ registeredWalletPage: page }) => {
    await mockHorizonAccount(page, E2E_PUBLIC_KEY, "50.0000000");
    await mockSorobanRpcNotRegistered(page); // any non-registry RPC call still resolves cleanly
    await page.goto("/app");
    await page.getByRole("button", { name: /connect wallet & initialize/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
  });

  test("dashboard shows Send/Receive action cards and quick links", async ({ registeredWalletPage: page }) => {
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Receive" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Private balance" })).toBeVisible();
    await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  });

  test("navigating to Send shows the send form and validates input", async ({ registeredWalletPage: page }) => {
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("heading", { name: "Send XLM" })).toBeVisible();

    const recipientInput = page.getByPlaceholder("G… Stellar address or 0x02… meta-address");
    const amountInput = page.getByPlaceholder("0.0");

    // Empty submit.
    await page.getByRole("button", { name: /send privately/i }).click();
    await expect(page.getByText("Enter recipient and amount.")).toBeVisible();

    // Malformed recipient surfaces an inline hint as soon as it's typed.
    await recipientInput.fill("not-a-valid-address");
    await expect(
      page.getByText(/registered stellar address .*or a stealth meta-address/i),
    ).toBeVisible();

    // A recipient that is the right shape (0x02/0x03 + 130 hex chars) but not
    // a real point on secp256k1 fails client-side, before any network call:
    // computeStealthAddressAndViewTag (frontend/src/lib/stealth.ts) rejects
    // it as an invalid curve point. That's still a real, useful assertion —
    // the UI surfaces the failure instead of hanging or crashing. A fully
    // successful on-chain send additionally requires Soroban RPC
    // simulate/assemble mocking; see wallet-connect.spec.ts and
    // e2e/README.md for why that's out of scope here.
    await recipientInput.fill(FAKE_META_ADDRESS_HEX);
    await amountInput.fill("1");
    await page.getByRole("button", { name: /send privately/i }).click();
    await expect(page.getByText(/bad point|err|fail/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("navigating to Receive shows the stealth meta-address and payment options", async ({
    registeredWalletPage: page,
  }) => {
    await page.getByRole("button", { name: "Receive" }).click();
    await expect(page.getByRole("heading", { name: "Receive" })).toBeVisible();
    await expect(page.getByText(/choose how you want to receive payments privately/i)).toBeVisible();
  });

  test("transaction history renders seeded entries", async ({ registeredWalletPage: page }) => {
    await page.evaluate(() => {
      const entry = {
        id: "tx-testnet-seed-1",
        cluster: "testnet",
        kind: "sent",
        counterparty: "GABC…WXYZ",
        amountStroops: "15000000",
        tokenSymbol: "XLM",
        tokenAddress: null,
        amount: "1.5",
        txHash: "e2e-seed-tx-hash",
        timestamp: Date.now(),
      };
      localStorage.setItem(
        "opaque-tx-history",
        JSON.stringify({ state: { byChain: { testnet: [entry] } }, version: 0 }),
      );
    });
    // In-memory wallet/key state (StellarWalletProviders, KeysContext) is
    // not persisted, so a reload drops back to the landing screen — only
    // localStorage-backed state (like tx history) survives. Reconnect.
    await page.reload();
    await page.getByRole("button", { name: /connect wallet & initialize/i }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("GABC…WXYZ")).toBeVisible();
    await expect(page.getByText(/1\.5/).first()).toBeVisible();
  });
});
