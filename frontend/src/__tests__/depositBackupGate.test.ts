import { describe, it, expect, beforeEach } from "vitest";
import {
  createDepositBackupSession,
  loadDepositBackupSession,
  clearDepositBackupSession,
  verifyDepositFragment,
} from "../lib/depositBackupGate";

describe("Deposit Backup Confirmation Gate (Issue #552)", () => {
  beforeEach(() => {
    // Mock sessionStorage
    const storage: Record<string, string> = {};
    globalThis.window = {
      sessionStorage: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => { storage[k] = v; },
        removeItem: (k: string) => { delete storage[k]; },
        clear: () => { for (const k in storage) delete storage[k]; },
        key: () => null,
        length: 0,
      },
    } as unknown as Window & typeof globalThis;
  });

  it("creates a deposit backup session with verification challenge", () => {
    const session = createDepositBackupSession({
      cluster: "testnet",
      depositor: "GBTESTDEPOSITORWALLETADDRESS1234567890",
      amountXlm: "10.00",
      valueStroops: "100000000",
      commitmentHex: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      nullifierHex: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      secretHex: "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210A1B2C3",
    });

    expect(session.id).toContain("dep_gate_");
    expect(session.verified).toBe(false);
    expect(session.expectedFragment).toBe("A1B2C3");
    expect(session.challengePrompt).toContain("last 6 characters");
  });

  it("blocks verification when user enters incorrect fragment", () => {
    const session = createDepositBackupSession({
      cluster: "testnet",
      depositor: "GBTESTDEPOSITORWALLETADDRESS1234567890",
      amountXlm: "5.00",
      valueStroops: "50000000",
      commitmentHex: "0x1111",
      nullifierHex: "0x2222",
      secretHex: "0x9999888877776666555544443333222211110000AABBCC",
    });

    const isMatch = verifyDepositFragment(session, "WRONG1");
    expect(isMatch).toBe(false);
    expect(session.verified).toBe(false);
  });

  it("approves verification when user enters correct fragment (case-insensitive)", () => {
    const session = createDepositBackupSession({
      cluster: "testnet",
      depositor: "GBTESTDEPOSITORWALLETADDRESS1234567890",
      amountXlm: "5.00",
      valueStroops: "50000000",
      commitmentHex: "0x1111",
      nullifierHex: "0x2222",
      secretHex: "0x9999888877776666555544443333222211110000AABBCC",
    });

    const isMatch = verifyDepositFragment(session, "aabbcc");
    expect(isMatch).toBe(true);
    expect(session.verified).toBe(true);
  });

  it("persists uncompleted gate state in sessionStorage to block reload bypass", () => {
    const session = createDepositBackupSession({
      cluster: "testnet",
      depositor: "GBTESTDEPOSITORWALLETADDRESS1234567890",
      amountXlm: "1.00",
      valueStroops: "10000000",
      commitmentHex: "0x3333",
      nullifierHex: "0x4444",
      secretHex: "0x5555666677778888999900001111222233334444FEDCBA",
    });

    // Simulate page reload: load from session storage
    const loadedSession = loadDepositBackupSession();
    expect(loadedSession).not.toBeNull();
    expect(loadedSession?.id).toBe(session.id);
    expect(loadedSession?.verified).toBe(false);

    // Clear session
    clearDepositBackupSession();
    expect(loadDepositBackupSession()).toBeNull();
  });
});
