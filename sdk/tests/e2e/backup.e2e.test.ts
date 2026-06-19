/**
 * End-to-end encrypted backup: encrypt stealth ephemeral keys with a PIN, then
 * decrypt them back. Confirms metadata stays readable, the secret round-trips,
 * and a wrong password fails to decrypt.
 */
import { describe, it, expect } from "vitest";
import {
  encryptGhostEntries,
  decryptGhostEntries,
  exportEncryptedBackup,
  importEncryptedBackup,
  type GhostEntryLike,
} from "../../src/crypto/index";

const ENTRIES: GhostEntryLike[] = [
  {
    cluster: "testnet",
    stealthAddress: "0xabc123",
    ephemeralPrivKeyHex: "0x" + "11".repeat(32),
    createdAt: 1_700_000_000,
  },
  {
    cluster: "testnet",
    stealthAddress: "0xdef456",
    ephemeralPrivKeyHex: "0x" + "22".repeat(32),
    createdAt: 1_700_000_500,
  },
];

describe("encrypted ghost backup (end to end)", () => {
  it("round-trips entries through encrypt/decrypt", async () => {
    const payload = await encryptGhostEntries(ENTRIES, "correct horse battery");
    expect(payload.version).toBe(1);
    // Metadata stays readable; the secret is encrypted.
    expect(payload.entries[0].stealthAddress).toBe("0xabc123");
    expect(payload.entries[0].ephemeralPrivKeyEncrypted).toBeDefined();
    expect(JSON.stringify(payload)).not.toContain("11".repeat(32));

    const decrypted = await decryptGhostEntries(payload, "correct horse battery");
    expect(decrypted).toEqual(ENTRIES);
  });

  it("fails to decrypt with the wrong password", async () => {
    const payload = await encryptGhostEntries(ENTRIES, "right-pin");
    await expect(decryptGhostEntries(payload, "wrong-pin")).rejects.toThrow();
  });

  it("round-trips through the JSON export/import helpers", async () => {
    const json = await exportEncryptedBackup(ENTRIES, "pin-1234");
    const restored = await importEncryptedBackup(json, "pin-1234");
    expect(restored).toEqual(ENTRIES);
  });
});
