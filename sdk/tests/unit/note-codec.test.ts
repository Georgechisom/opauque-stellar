import { describe, it, expect } from "vitest";
import {
  serializeNote,
  deserializeNote,
  encodeNoteJson,
  decodeNoteJson,
  serializeNotes,
  deserializeNotes,
  CURRENT_NOTE_SCHEMA_VERSION,
  type PoolNote,
} from "../../src/crypto/index";
import { NoteSchemaError } from "../../src/errors/index";

const baseNote: PoolNote = {
  cluster: "testnet",
  poolId: "CPOOL",
  value: "5000000",
  scope: 1,
  leafIndex: 3,
  nullifier: "111",
  secret: "222",
  commitment: "0xabc",
  spent: false,
  createdAt: 1_700_000_000,
};

describe("note schema versioning", () => {
  it("serializes the current shape with poolId under the current version", () => {
    const serialized = serializeNote(baseNote);
    expect(serialized.version).toBe(CURRENT_NOTE_SCHEMA_VERSION);
    expect((serialized as { poolId: string }).poolId).toBe("CPOOL");
  });

  it("round-trips a v2 note through JSON", () => {
    const json = encodeNoteJson(baseNote);
    expect(decodeNoteJson(json)).toEqual(baseNote);
  });

  it("decodes a legacy v1 note (no version field, no poolId)", () => {
    const legacy = {
      cluster: "testnet",
      value: "5000000",
      scope: 1,
      leafIndex: 3,
      nullifier: "111",
      secret: "222",
      commitment: "0xabc",
      spent: false,
      createdAt: 1_700_000_000,
    };
    const note = deserializeNote(legacy);
    expect(note.poolId).toBeUndefined();
    expect(note.commitment).toBe("0xabc");
  });

  it("decodes an explicit v1-tagged note", () => {
    const v1 = { version: 1, ...baseNote, poolId: undefined };
    delete (v1 as Record<string, unknown>).poolId;
    const note = deserializeNote(v1);
    expect(note.poolId).toBeUndefined();
  });

  it("decodes an explicit v2-tagged note with poolId", () => {
    const v2 = { version: 2, ...baseNote };
    const note = deserializeNote(v2);
    expect(note.poolId).toBe("CPOOL");
  });

  it("fails closed on an unknown version rather than guessing a shape", () => {
    expect(() => deserializeNote({ version: 99, ...baseNote })).toThrow(NoteSchemaError);
  });

  it("fails closed on a malformed field with a clear message", () => {
    expect(() => deserializeNote({ ...baseNote, leafIndex: "3" })).toThrow(
      /leafIndex.*must be a finite number/,
    );
  });

  it("rejects non-object input and invalid JSON", () => {
    expect(() => deserializeNote(null)).toThrow(NoteSchemaError);
    expect(() => deserializeNote("nope")).toThrow(NoteSchemaError);
    expect(() => decodeNoteJson("{not json")).toThrow(NoteSchemaError);
  });

  it("serializes and deserializes a batch", () => {
    const legacyNote: PoolNote = { ...baseNote, poolId: undefined };
    const batch = serializeNotes([baseNote, legacyNote]);
    expect(batch[0].version).toBe(2);
    expect(batch[1].version).toBe(1);
    expect(deserializeNotes(batch)).toEqual([baseNote, legacyNote]);
  });
});
