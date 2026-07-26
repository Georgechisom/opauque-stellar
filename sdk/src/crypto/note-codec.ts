/**
 * Versioned (de)serialization for {@link PoolNote}. Notes are the client's only
 * copy of its spending material, so a host app persisting them as plain JSON has
 * no way to tell which shape it wrote once a field is added or renamed. Every
 * serialized note carries an explicit `version`; decoding switches on it and
 * keeps one path per historical version so old stored notes keep loading after
 * the shape changes.
 *
 * v1 predates `poolId` (single-pool deployments only, field omitted entirely).
 * v2 adds `poolId` to disambiguate notes across multiple deployed pools.
 */
import { NoteSchemaError } from "../errors/index";
import type { PoolNote } from "./notes";

/** Current schema version new serialized notes are written with. */
export const CURRENT_NOTE_SCHEMA_VERSION = 2;

interface SerializedNoteV1 {
  version: 1;
  cluster: string;
  value: string;
  scope: number;
  leafIndex: number;
  nullifier: string;
  secret: string;
  commitment: string;
  spent: boolean;
  createdAt: number;
}

interface SerializedNoteV2 extends Omit<SerializedNoteV1, "version"> {
  version: 2;
  poolId: string;
}

/** The on-the-wire / on-disk shape produced by {@link serializeNote}. */
export type SerializedNote = SerializedNoteV1 | SerializedNoteV2;

function field(raw: Record<string, unknown>, key: string): unknown {
  return raw[key];
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const v = field(raw, key);
  if (typeof v !== "string") {
    throw new NoteSchemaError(`Serialized note field "${key}" must be a string`);
  }
  return v;
}

function requireNumber(raw: Record<string, unknown>, key: string): number {
  const v = field(raw, key);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new NoteSchemaError(`Serialized note field "${key}" must be a finite number`);
  }
  return v;
}

function requireBoolean(raw: Record<string, unknown>, key: string): boolean {
  const v = field(raw, key);
  if (typeof v !== "boolean") {
    throw new NoteSchemaError(`Serialized note field "${key}" must be a boolean`);
  }
  return v;
}

/** Decode paths per historical version. Each returns the current {@link PoolNote} shape. */
const decoders: Record<number, (raw: Record<string, unknown>) => PoolNote> = {
  1: (raw) => ({
    cluster: requireString(raw, "cluster"),
    value: requireString(raw, "value"),
    scope: requireNumber(raw, "scope"),
    leafIndex: requireNumber(raw, "leafIndex"),
    nullifier: requireString(raw, "nullifier"),
    secret: requireString(raw, "secret"),
    commitment: requireString(raw, "commitment"),
    spent: requireBoolean(raw, "spent"),
    createdAt: requireNumber(raw, "createdAt"),
  }),
  2: (raw) => ({
    ...decoders[1](raw),
    poolId: requireString(raw, "poolId"),
  }),
};

/** Serialize a note with the current schema version embedded. */
export function serializeNote(note: PoolNote): SerializedNote {
  if (note.poolId === undefined) {
    return {
      version: 1,
      cluster: note.cluster,
      value: note.value,
      scope: note.scope,
      leafIndex: note.leafIndex,
      nullifier: note.nullifier,
      secret: note.secret,
      commitment: note.commitment,
      spent: note.spent,
      createdAt: note.createdAt,
    };
  }
  return {
    version: CURRENT_NOTE_SCHEMA_VERSION,
    cluster: note.cluster,
    poolId: note.poolId,
    value: note.value,
    scope: note.scope,
    leafIndex: note.leafIndex,
    nullifier: note.nullifier,
    secret: note.secret,
    commitment: note.commitment,
    spent: note.spent,
    createdAt: note.createdAt,
  };
}

/**
 * Decode a serialized note. Missing `version` is treated as v1 (predates
 * versioning). Unknown versions fail closed rather than guessing a shape.
 */
export function deserializeNote(data: unknown): PoolNote {
  if (typeof data !== "object" || data === null) {
    throw new NoteSchemaError("Serialized note must be an object");
  }
  const raw = data as Record<string, unknown>;
  const version = raw.version === undefined ? 1 : raw.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new NoteSchemaError(`Serialized note has a non-integer version: ${String(version)}`);
  }
  const decode = decoders[version];
  if (!decode) {
    throw new NoteSchemaError(`Unsupported note schema version: ${version}`);
  }
  return decode(raw);
}

/** Serialize a note to a JSON string. */
export function encodeNoteJson(note: PoolNote): string {
  return JSON.stringify(serializeNote(note));
}

/** Decode a note from a JSON string produced by {@link encodeNoteJson}. */
export function decodeNoteJson(json: string): PoolNote {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new NoteSchemaError("Serialized note is not valid JSON", { cause });
  }
  return deserializeNote(parsed);
}

/** Serialize a batch of notes (e.g. for a full-wallet export). */
export function serializeNotes(notes: PoolNote[]): SerializedNote[] {
  return notes.map(serializeNote);
}

/** Decode a batch of notes produced by {@link serializeNotes}. */
export function deserializeNotes(data: unknown[]): PoolNote[] {
  return data.map(deserializeNote);
}
