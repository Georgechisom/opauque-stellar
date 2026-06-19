/**
 * End-to-end schema + attestation codec: register a schema's field shape,
 * compute its deterministic id, then encode and decode attestation payloads
 * across every supported field type. Encoding must byte-match the Soroban
 * schema/attestation contracts.
 */
import { describe, it, expect } from "vitest";
import {
  parseFieldDefinitions,
  fieldDefsToCanonicalString,
  computeSchemaId,
  encodeAttestationData,
  decodeAttestationData,
  SchemaParseError,
  AttestationDataError,
} from "../../src/crypto/index";

// A valid testnet G-address used as the schema authority.
const AUTHORITY = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";

describe("schema + attestation codec (end to end)", () => {
  it("parses field definitions into canonical, ordered form", () => {
    const fields = parseFieldDefinitions("u64 score, bool verified, string handle");
    expect(fields.map((f) => f.name)).toEqual(["score", "verified", "handle"]);
    expect(fields.map((f) => f.id)).toEqual(["0", "1", "2"]);
    expect(fieldDefsToCanonicalString(fields)).toBe(
      "u64 score,bool verified,string handle",
    );
  });

  it("computes a deterministic schema id sensitive to its inputs", async () => {
    const defs = "u64 score, bool verified";
    const id1 = await computeSchemaId(AUTHORITY, "credit", defs);
    const id2 = await computeSchemaId(AUTHORITY, "credit", defs);
    expect(id1).toEqual(id2);
    expect(id1.length).toBe(32);

    const idName = await computeSchemaId(AUTHORITY, "reputation", defs);
    const idDefs = await computeSchemaId(AUTHORITY, "credit", "u64 score, bool flagged");
    const idVer = await computeSchemaId(AUTHORITY, "credit", defs, 2);
    const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
    expect(new Set([hex(id1), hex(idName), hex(idDefs), hex(idVer)]).size).toBe(4);
  });

  it("round-trips attestation data across every field type", () => {
    const fields = parseFieldDefinitions(
      "bool active, u8 tier, u16 region, u32 count, u64 score, string handle, pubkey owner",
    );
    const values = {
      active: "true",
      tier: "7",
      region: "65000",
      count: "4000000000",
      score: "18446744073709551610",
      handle: "satoshi",
      owner: "0x" + "ab".repeat(32),
    };

    const encoded = encodeAttestationData(values, fields);
    const decoded = decodeAttestationData(encoded, fields);

    expect(decoded.active).toBe("true");
    expect(decoded.tier).toBe("7");
    expect(decoded.region).toBe("65000");
    expect(decoded.count).toBe("4000000000");
    expect(decoded.score).toBe("18446744073709551610");
    expect(decoded.handle).toBe("satoshi");
    expect(decoded.owner).toBe(values.owner);
  });

  it("rejects malformed field definitions and out-of-range data", () => {
    expect(() => parseFieldDefinitions("")).toThrow(SchemaParseError);
    expect(() => parseFieldDefinitions("score:u64")).toThrow(SchemaParseError);
    expect(() => parseFieldDefinitions("u64 score, u64 score")).toThrow(SchemaParseError);

    const fields = parseFieldDefinitions("u8 tier");
    expect(() => encodeAttestationData({ tier: "256" }, fields)).toThrow(
      AttestationDataError,
    );
  });

  it("treats missing optional values as zero/empty", () => {
    const fields = parseFieldDefinitions("u32 count, string note");
    const encoded = encodeAttestationData({}, fields);
    const decoded = decodeAttestationData(encoded, fields);
    expect(decoded.count).toBe("0");
    expect(decoded.note).toBe("");
  });
});
