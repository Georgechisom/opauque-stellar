/**
 * End-to-end privacy-pool note crypto: derive a deposit's commitment material
 * from fresh secrets, then re-derive the spend-side material (nullifier hash)
 * the same way a withdrawal would. Verifies determinism, field membership, and
 * sensitivity of the commitment to its inputs. Poseidon must byte-match
 * circuits/v3 + the privacy-pool contract.
 */
import { describe, it, expect } from "vitest";
import {
  BN254_R,
  POOL_TREE_DEPTH,
  deriveDeposit,
  newNoteSecrets,
  unspentTotal,
  toHex32,
  type PoolNote,
} from "../../src/crypto/index";

const SCOPE = 42;

describe("privacy-pool note lifecycle (end to end)", () => {
  it("derives deterministic commitment material from secrets", async () => {
    const opts = {
      value: 5_000_000n,
      scope: SCOPE,
      leafIndex: 3,
      nullifier: 12345678901234567890n,
      secret: 98765432109876543210n,
    };
    const a = await deriveDeposit(opts);
    const b = await deriveDeposit(opts);

    expect(a.commitment).toBe(b.commitment);
    expect(a.label).toBe(b.label);
    expect(a.precommitment).toBe(b.precommitment);
    expect(a.nullifierHash).toBe(b.nullifierHash);

    // All outputs are valid BN254 field elements.
    for (const v of [a.label, a.precommitment, a.commitment, a.nullifierHash]) {
      expect(v).toBeGreaterThan(0n);
      expect(v).toBeLessThan(BN254_R);
    }
  });

  it("nullifier hash is reproducible at withdrawal time", async () => {
    const { nullifier, secret } = newNoteSecrets();
    const depositValue = 1_000_000n;
    const leafIndex = 7;

    const deposit = await deriveDeposit({
      value: depositValue,
      scope: SCOPE,
      leafIndex,
      nullifier: BigInt(nullifier),
      secret: BigInt(secret),
    });

    // Spend side recomputes the same nullifier hash from the stored secret.
    const spend = await deriveDeposit({
      value: depositValue,
      scope: SCOPE,
      leafIndex,
      nullifier: BigInt(nullifier),
      secret: BigInt(secret),
    });
    expect(spend.nullifierHash).toBe(deposit.nullifierHash);
    expect(toHex32(deposit.commitment)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("commitment changes when any input changes", async () => {
    const base = {
      value: 2_000_000n,
      scope: SCOPE,
      leafIndex: 1,
      nullifier: 111n,
      secret: 222n,
    };
    const c0 = (await deriveDeposit(base)).commitment;
    const cValue = (await deriveDeposit({ ...base, value: 2_000_001n })).commitment;
    const cIndex = (await deriveDeposit({ ...base, leafIndex: 2 })).commitment;
    const cNull = (await deriveDeposit({ ...base, nullifier: 112n })).commitment;
    const cSecret = (await deriveDeposit({ ...base, secret: 223n })).commitment;

    expect(new Set([c0, cValue, cIndex, cNull, cSecret]).size).toBe(5);
  });

  it("fresh secrets are distinct field elements", () => {
    const a = newNoteSecrets();
    const b = newNoteSecrets();
    expect(a.nullifier).not.toBe(b.nullifier);
    expect(a.secret).not.toBe(b.secret);
    expect(BigInt(a.nullifier)).toBeLessThan(BN254_R);
    expect(BigInt(a.secret)).toBeLessThan(BN254_R);
  });

  it("sums unspent note balances and ignores spent notes", () => {
    const note = (value: string, spent: boolean): PoolNote => ({
      cluster: "testnet",
      value,
      scope: SCOPE,
      leafIndex: 0,
      nullifier: "1",
      secret: "2",
      commitment: "0x00",
      spent,
      createdAt: 0,
    });
    const notes = [note("5000000", false), note("3000000", false), note("9000000", true)];
    expect(unspentTotal(notes)).toBe(8_000_000n);
  });

  it("exposes the canonical tree depth", () => {
    expect(POOL_TREE_DEPTH).toBe(20);
  });
});
