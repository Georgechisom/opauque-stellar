/**
 * End-to-end witness construction (no snarkjs): the V2 reputation witness is
 * built from a stealth key + trait + external nullifier via Poseidon. Verifies
 * determinism, field shape, and sensitivity to the external nullifier (so the
 * on-chain nullifier hash changes per app context).
 */
import { describe, it, expect } from "vitest";
import { buildReputationWitnessV2, BN254_R } from "../../src/index";

const STEALTH_PRIV = new Uint8Array(32).fill(9);

describe("reputation V2 witness (end to end)", () => {
  it("is deterministic and well-formed", async () => {
    const input = {
      attestationId: 7,
      stealthPrivKey: STEALTH_PRIV,
      externalNullifier: 123n,
    };
    const w1 = await buildReputationWitnessV2(input);
    const w2 = await buildReputationWitnessV2(input);

    expect(w1).toEqual(w2);
    expect(w1.attestation_id).toBe("7");
    expect(w1.external_nullifier).toBe("123");
    expect(w1.merkle_path.length).toBe(20);
    expect(w1.merkle_path_indices).toEqual(new Array(20).fill(0));
    // field elements are < r
    expect(BigInt(w1.merkle_root)).toBeLessThan(BN254_R);
    expect(BigInt(w1.nullifier_hash)).toBeLessThan(BN254_R);
  });

  it("changes the nullifier hash when the external nullifier changes", async () => {
    const a = await buildReputationWitnessV2({
      attestationId: 7,
      stealthPrivKey: STEALTH_PRIV,
      externalNullifier: 1n,
    });
    const b = await buildReputationWitnessV2({
      attestationId: 7,
      stealthPrivKey: STEALTH_PRIV,
      externalNullifier: 2n,
    });
    expect(a.nullifier_hash).not.toBe(b.nullifier_hash);
    // same attestation + key -> same leaf/root regardless of external nullifier
    expect(a.merkle_root).toBe(b.merkle_root);
  });
});
