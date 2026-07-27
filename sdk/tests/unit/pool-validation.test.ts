import { describe, it, expect } from "vitest";
import { validateDepositAmount, PoolValidationError, BN254_R } from "../../src/index";

describe("deposit amount validation", () => {
  it("accepts a well-formed amount within the backing asset's precision", () => {
    expect(() =>
      validateDepositAmount({ amountXlm: "1.5000000", valueStroops: 15_000_000n, decimals: 7 }),
    ).not.toThrow();
  });

  it("rejects a zero or negative amount as non-positive", () => {
    expect(() =>
      validateDepositAmount({ amountXlm: "0", valueStroops: 0n, decimals: 7 }),
    ).toThrow(PoolValidationError);
    try {
      validateDepositAmount({ amountXlm: "0", valueStroops: 0n, decimals: 7 });
    } catch (err) {
      expect((err as PoolValidationError).constraint).toBe("non-positive");
    }
  });

  it("rejects an amount at or above the BN254 field modulus", () => {
    try {
      validateDepositAmount({ amountXlm: "huge", valueStroops: BN254_R, decimals: 7 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PoolValidationError);
      expect((err as PoolValidationError).constraint).toBe("exceeds-field-modulus");
    }
  });

  it("rejects more decimal places than the live asset supports", () => {
    // 8 decimals requested against an asset that only supports 7.
    try {
      validateDepositAmount({ amountXlm: "1.23456789", valueStroops: 123456789n, decimals: 7 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PoolValidationError);
      expect((err as PoolValidationError).constraint).toBe("precision");
    }
  });

  it("uses the live decimals value rather than a hardcoded assumption", () => {
    // 3 decimals is fine against a 7-decimal asset...
    expect(() =>
      validateDepositAmount({ amountXlm: "1.234", valueStroops: 1_234_0000n, decimals: 7 }),
    ).not.toThrow();
    // ...but rejected against a hypothetical 2-decimal asset.
    try {
      validateDepositAmount({ amountXlm: "1.234", valueStroops: 1_234_0000n, decimals: 2 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PoolValidationError);
      expect((err as PoolValidationError).constraint).toBe("precision");
    }
  });
});
