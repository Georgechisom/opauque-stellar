import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import {
  BACKUP_FORMAT_VERSION,
  createVersionedNoteBackupEnvelope,
  buildEncryptedPoolNoteBackup,
  importEncryptedPoolNoteBackup,
  CorruptedBackupError,
  InvalidPasswordError,
} from "../lib/poolNoteBackup";
import type { PoolNote } from "../lib/poolNotes";

beforeAll(() => {
  if (!globalThis.crypto) {
    (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

describe("Versioned Note Backup Format & Migration (Issue #553)", () => {
  const dummyNotes: PoolNote[] = [
    {
      cluster: "testnet",
      poolId: "pool-xlm-v1",
      value: "100000000",
      scope: 1,
      leafIndex: 42,
      nullifier: "0x1111222233334444555566667777888899990000111122223333444455556666",
      secret: "0xaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999",
      commitment: "0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff",
      spent: false,
      createdAt: 1700000000000,
    },
  ];

  const pin = "123456";

  it("exports a versioned envelope embedding formatVersion and integrity checksum", async () => {
    const { envelope } = await createVersionedNoteBackupEnvelope({
      notes: dummyNotes,
      pin,
      cluster: "testnet",
      poolId: "pool-xlm-v1",
      appVersion: "2.0.0",
    });

    expect(envelope.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(envelope.formatVersion).toBe(2);
    expect(envelope.integrityChecksum).toBeDefined();
    expect(envelope.integrityChecksum.length).toBe(64); // SHA-256 hex string
    expect(envelope.noteCount).toBe(1);
    expect(envelope.cipher).toBe("AES-256-GCM");
    expect(envelope.kdf).toBe("PBKDF2-SHA256");
  });

  it("successfully decrypts and imports from versioned JSON envelope", async () => {
    const { envelope } = await createVersionedNoteBackupEnvelope({
      notes: dummyNotes,
      pin,
      cluster: "testnet",
      poolId: "pool-xlm-v1",
    });

    const jsonString = JSON.stringify(envelope);
    const imported = await importEncryptedPoolNoteBackup(jsonString, pin);

    expect(imported.version).toBe(2);
    expect(imported.notes.length).toBe(1);
    expect(imported.notes[0].nullifier).toBe(dummyNotes[0].nullifier);
    expect(imported.notes[0].secret).toBe(dummyNotes[0].secret);
    expect(imported.notes[0].value).toBe(dummyNotes[0].value);
  });

  it("successfully builds and imports from versioned ZIP archive", async () => {
    const zipBlob = await buildEncryptedPoolNoteBackup({
      notes: dummyNotes,
      pin,
      cluster: "testnet",
      poolId: "pool-xlm-v1",
    });

    const imported = await importEncryptedPoolNoteBackup(zipBlob, pin);
    expect(imported.notes.length).toBe(1);
    expect(imported.notes[0].commitment).toBe(dummyNotes[0].commitment);
  });

  it("fails with InvalidPasswordError when wrong PIN is supplied", async () => {
    const { envelope } = await createVersionedNoteBackupEnvelope({
      notes: dummyNotes,
      pin,
      cluster: "testnet",
    });

    await expect(importEncryptedPoolNoteBackup(JSON.stringify(envelope), "wrong-pin")).rejects.toThrow(
      InvalidPasswordError
    );
  });

  it("fails with CorruptedBackupError when payload checksum is tampered", async () => {
    const { envelope } = await createVersionedNoteBackupEnvelope({
      notes: dummyNotes,
      pin,
      cluster: "testnet",
    });

    // Tamper with ciphertext
    envelope.encryptedPayload = btoa("corrupted-ciphertext-data");

    await expect(importEncryptedPoolNoteBackup(JSON.stringify(envelope), pin)).rejects.toThrow(
      CorruptedBackupError
    );
  });

  it("migrates legacy unversioned note structures cleanly", async () => {
    const legacyRaw = [
      {
        nullifier: "0xlegacy1",
        secret: "0xlegacy2",
        value: "50000000",
        leafIndex: 3,
      },
    ];

    const { envelope } = await createVersionedNoteBackupEnvelope({
      notes: legacyRaw as unknown as PoolNote[],
      pin,
      cluster: "testnet",
    });

    const imported = await importEncryptedPoolNoteBackup(JSON.stringify(envelope), pin);
    expect(imported.notes.length).toBe(1);
    expect(imported.notes[0].nullifier).toBe("0xlegacy1");
    expect(imported.notes[0].cluster).toBe("testnet");
    expect(imported.notes[0].spent).toBe(false);
  });
});
