import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { KeyRotationManager } from "../services/keyRotationManager";
import { webcrypto } from "node:crypto";

beforeAll(() => {
  if (!globalThis.crypto) {
    (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

describe("KeyRotationManager (Issue #554)", () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    for (const key in mockStorage) delete mockStorage[key];
    globalThis.window = {
      localStorage: {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
        key: () => null,
        length: 0,
      },
    } as unknown as Window & typeof globalThis;
  });

  it("generates a new valid stealth meta-address and keypair", async () => {
    const res = await KeyRotationManager.generateNewMetaAddress("0xOLD_META_ADDRESS");

    expect(res.metaAddressHex).toBeDefined();
    expect(res.metaAddressHex.startsWith("0x")).toBe(true);
    expect(res.viewingKeyHex.startsWith("0x")).toBe(true);
    expect(res.spendingKeyHex.startsWith("0x")).toBe(true);
    expect(res.metaAddressHex).not.toEqual("0xOLD_META_ADDRESS");
  });

  it("rotates keys, registers grace period, and saves record to local storage only", async () => {
    const oldAddr = "0x021111111111111111111111111111111111111111111111111111111111111111022222222222222222222222222222222222222222222222222222222222222222";
    const { record, newMetaAddress } = await KeyRotationManager.rotateKeys({
      oldMetaAddress: oldAddr,
      gracePeriodDays: 14,
      oldViewingKeyHex: "0xoldviewkey",
      oldSpendingKeyHex: "0xoldspendkey",
    });

    expect(record.oldMetaAddress).toBe(oldAddr);
    expect(record.newMetaAddress).toBe(newMetaAddress);
    expect(record.gracePeriodDays).toBe(14);
    expect(record.isScanningActive).toBe(true);

    const history = KeyRotationManager.getRotationHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(record.id);
  });

  it("returns active legacy keys for straggler scanning within grace period", async () => {
    const oldAddr = "0x02oldmeta";
    await KeyRotationManager.rotateKeys({
      oldMetaAddress: oldAddr,
      gracePeriodDays: 30,
      oldViewingKeyHex: "0xlegacy_view_key_123",
    });

    const activeScanKeys = KeyRotationManager.getActiveGraceScanningKeys();
    expect(activeScanKeys.length).toBe(1);
    expect(activeScanKeys[0].metaAddress).toBe(oldAddr);
    expect(activeScanKeys[0].viewingKeyHex).toBe("0xlegacy_view_key_123");
  });

  it("returns the 5 migration steps for the guided rotation flow", () => {
    const steps = KeyRotationManager.getMigrationSteps();
    expect(steps.length).toBe(5);
    expect(steps[0].title).toBe("Configure Grace Period");
    expect(steps[4].title).toBe("Share New Address");
  });
});
