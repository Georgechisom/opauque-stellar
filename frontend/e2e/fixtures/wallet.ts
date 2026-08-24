import { test as base, type Page } from "@playwright/test";

/**
 * Deterministic testnet keypair used across the E2E suite. It is never
 * funded and never signs anything for real — the E2E wallet harness (see
 * `frontend/src/context/StellarWalletProviders.tsx`) short-circuits all
 * Freighter calls before they'd reach a real key.
 */
export const E2E_PUBLIC_KEY = "GCPO6PVWX2WZ7JJH2M7IY47EABGGDFHYCIBZUIWVD7XAVTDJLW3QWYIP";

/** Deterministic 64-byte "signature" payload used for message-signing mocks. */
function fakeSignatureBytesArray(): number[] {
  return Array.from({ length: 64 }, (_, i) => (i * 7 + 11) & 0xff);
}

/**
 * Injects `window.__OPAQUE_E2E_WALLET__` before any app script runs, so the
 * StellarWalletProviders test harness picks it up on first render instead of
 * calling the real `@stellar/freighter-api` (which requires an actual
 * extension host and isn't present in a headless/CI browser).
 */
export async function installMockFreighter(page: Page, publicKey = E2E_PUBLIC_KEY): Promise<void> {
  await page.addInitScript(
    ({ publicKey, sigBytes }) => {
      (window as unknown as { __OPAQUE_E2E_WALLET__: unknown }).__OPAQUE_E2E_WALLET__ = {
        publicKey,
        signTransaction: async (xdr: string) => xdr, // pass-through "signed" XDR for UI-level assertions
        signMessage: async (_message: Uint8Array) => new Uint8Array(sigBytes),
      };
    },
    { publicKey, sigBytes: fakeSignatureBytesArray() },
  );
}

/** A syntactically-valid-looking (but fake) 66-byte stealth meta-address hex string. */
export const FAKE_META_ADDRESS_HEX = ("0x02" + "ab".repeat(65)) as `0x${string}`;

/**
 * Injects `window.__OPAQUE_E2E_REGISTERED_META__` so `isRegistered()`
 * (frontend/src/lib/registry.ts) short-circuits to "already registered"
 * without a real Soroban round trip. Use for tests that need to reach the
 * Dashboard/Send/Receive/History views directly instead of exercising the
 * registration wizard.
 */
export async function installMockRegistered(page: Page, metaAddressHex = FAKE_META_ADDRESS_HEX): Promise<void> {
  await page.addInitScript((meta) => {
    (window as unknown as { __OPAQUE_E2E_REGISTERED_META__: unknown }).__OPAQUE_E2E_REGISTERED_META__ = meta;
  }, metaAddressHex);
}

/**
 * Pre-marks the first-run onboarding tour (driver.js, see
 * `frontend/src/lib/onboardingTour.ts`) as already completed, via the same
 * `localStorage["opaque-tour-done"]` flag the app itself sets after a user
 * finishes it. Without this, the tour's full-screen overlay opens
 * automatically ~600ms after the Dashboard first mounts and intercepts
 * clicks on the Send/Receive cards underneath it.
 */
export async function skipOnboardingTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("opaque-tour-done", "1");
  });
}

export const test = base.extend<{ walletPage: Page; registeredWalletPage: Page }>({
  walletPage: async ({ page }, use) => {
    await installMockFreighter(page);
    await skipOnboardingTour(page);
    await use(page);
  },
  registeredWalletPage: async ({ page }, use) => {
    await installMockFreighter(page);
    await installMockRegistered(page);
    await skipOnboardingTour(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";
