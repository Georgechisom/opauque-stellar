import { describe, it, expect } from "vitest";
import { serializeGroth16Proof, bigIntToBytes32 } from "../../src/index";

describe("Groth16 proof serialization", () => {
  it("lays out A/B/C with the G2 coordinate swap and 32-byte BE limbs", () => {
    const proof = {
      pi_a: ["1", "2", "1"],
      pi_b: [["3", "4"], ["5", "6"], ["1", "0"]],
      pi_c: ["7", "8", "1"],
    };
    const { a, b, c } = serializeGroth16Proof(proof);

    expect(a.length).toBe(64);
    expect(b.length).toBe(128);
    expect(c.length).toBe(64);

    // A = x(1) ‖ y(2)
    expect(Array.from(a.slice(0, 32))).toEqual(Array.from(bigIntToBytes32(1n)));
    expect(Array.from(a.slice(32, 64))).toEqual(Array.from(bigIntToBytes32(2n)));

    // B = swap each pair: [4,3, 6,5]
    expect(Array.from(b.slice(0, 32))).toEqual(Array.from(bigIntToBytes32(4n)));
    expect(Array.from(b.slice(32, 64))).toEqual(Array.from(bigIntToBytes32(3n)));
    expect(Array.from(b.slice(64, 96))).toEqual(Array.from(bigIntToBytes32(6n)));
    expect(Array.from(b.slice(96, 128))).toEqual(Array.from(bigIntToBytes32(5n)));

    // C = x(7) ‖ y(8)
    expect(Array.from(c.slice(0, 32))).toEqual(Array.from(bigIntToBytes32(7n)));
    expect(Array.from(c.slice(32, 64))).toEqual(Array.from(bigIntToBytes32(8n)));
  });
});
