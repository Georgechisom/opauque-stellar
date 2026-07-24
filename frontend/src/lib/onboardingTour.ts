/**
 * driver.js onboarding tour for first-time users.
 *
 * Steps (demo session walkthrough):
 *   1. Meta-Address (Your ID) — how others find you
 *   2. Receive (Ghost Addresses) — generate one-time addresses
 *   3. Vault (Portfolio) — view your shielded balance
 *   4. Privacy Pool (Deposit) — shield XLM behind a commitment
 *   5. Withdrawal (Zero-Knowledge Proof) — unlinkable withdrawal to any address
 *
 * The walkthrough is skippable, never auto-repeats, and each step links
 * the UI action to its on-chain evidence without protocol jargon.
 */

import { driver } from "driver.js";
import "driver.js/dist/driver.css";

const TOUR_STORAGE_KEY = "opaque-tour-done";

export function hasCompletedOnboardingTour(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem(TOUR_STORAGE_KEY);
}

export function runOnboardingTour(force?: boolean): void {
  if (!force && hasCompletedOnboardingTour()) return;

  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayColor: "rgba(0, 0, 0, 0.75)",
    steps: [
      {
        element: '[data-tour="meta"]',
        popover: {
          title: "Your ID",
          description:
            "Your stealth meta-address is your private identity. Share it to receive payments that no one can link to each other.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: '[data-tour="receive"]',
        popover: {
          title: "Ghost Addresses",
          description:
            "Generate a one-time address for each payment. Every address is unique — no one can tell they belong to the same person.",
          side: "top",
          align: "center",
        },
      },
      {
        element: '[data-tour="vault"]',
        popover: {
          title: "Your Shielded Balance",
          description:
            "Your funds appear here, split across multiple stealth addresses. Click to see each one and manage them privately.",
          side: "top",
          align: "start",
        },
      },
      {
        element: '[data-tour="pool-deposit"]',
        popover: {
          title: "Deposit into the Privacy Pool",
          description:
            "Shield XLM behind a cryptographic commitment. The deposit is recorded on-chain, but the commitment reveals nothing about the amount or depositor.",
          side: "top",
          align: "center",
        },
      },
      {
        element: '[data-tour="pool-balance"]',
        popover: {
          title: "Pool Balance",
          description:
            "This shows how much XLM is locked in the pool. The pool's on-chain balance is the physical backstop that guarantees every withdrawal.",
          side: "bottom",
          align: "center",
        },
      },
      {
        element: '[data-tour="pool-withdraw"]',
        popover: {
          title: "Unlinkable Withdrawal",
          description:
            "Withdraw to any address using a zero-knowledge proof. The proof verifies you own a valid deposit without revealing which one — and the on-chain transaction cannot be linked back to your deposit.",
          side: "top",
          align: "center",
        },
      },
    ],
    onDestroyStarted: () => {
      if (typeof window !== "undefined") {
        localStorage.setItem(TOUR_STORAGE_KEY, "1");
      }
      d.destroy();
    },
  });

  d.drive();
}
