import { describe, it, expect } from "vitest";
import {
  classifyWalletError,
  type WalletConnectionErrorType,
} from "../walletErrors";

describe("classifyWalletError", () => {
  const cases: Array<{ input: unknown; expected: WalletConnectionErrorType }> = [
    // Extension missing
    { input: "Freighter extension is not installed", expected: "extension_missing" },
    { input: "window.__freighter is undefined", expected: "extension_missing" },
    { input: "Could not find Freighter", expected: "extension_missing" },
    { input: new Error("freighter not found"), expected: "extension_missing" },

    // Extension locked
    { input: "Wallet is locked", expected: "extension_locked" },
    { input: "Please unlock your wallet", expected: "extension_locked" },
    { input: "Enter your password", expected: "extension_locked" },
    { input: new Error("not authenticated"), expected: "extension_locked" },

    // Wrong network
    { input: "Network mismatch detected", expected: "wrong_network" },
    { input: "Wrong network selected", expected: "wrong_network" },
    { input: "Incorrect network", expected: "wrong_network" },
    { input: new Error("different network"), expected: "wrong_network" },

    // User rejected
    { input: "User rejected the request", expected: "user_rejected" },
    { input: "Connection denied by user", expected: "user_rejected" },
    { input: "Request was cancelled", expected: "user_rejected" },
    { input: new Error("user refused"), expected: "user_rejected" },

    // Access denied
    { input: "Access denied to Freighter", expected: "access_denied" },
    { input: "Not allowed to connect", expected: "access_denied" },
    { input: "Permission denied", expected: "access_denied" },
    { input: new Error("not authorized"), expected: "access_denied" },

    // Unknown
    { input: "Something went wrong", expected: "unknown" },
    { input: new Error("unexpected error"), expected: "unknown" },
    { input: "", expected: "unknown" },
    { input: null, expected: "unknown" },
    { input: undefined, expected: "unknown" },
  ];

  for (const { input, expected } of cases) {
    it(`classifies "${typeof input === "string" ? input.slice(0, 40) : String(input).slice(0, 40)}" as ${expected}`, () => {
      const result = classifyWalletError(input);
      expect(result.type).toBe(expected);
      expect(result.message).toBeTruthy();
      expect(result.guidance).toBeTruthy();
      expect(typeof result.canRetry).toBe("boolean");
    });
  }

  it("returns canRetry=false for extension_missing", () => {
    const result = classifyWalletError("Freighter not installed");
    expect(result.canRetry).toBe(false);
  });

  it("returns canRetry=true for extension_locked", () => {
    const result = classifyWalletError("Wallet is locked");
    expect(result.canRetry).toBe(true);
  });
});
