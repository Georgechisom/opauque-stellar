import { describe, it, expect } from "vitest";
import { memoRiskFor, validateMemo, memoWarningCopy } from "../../src/crypto/index";

describe("destination memo", () => {
  it("flags a known custodian and recommends a memo type", () => {
    const risk = memoRiskFor(
      "GA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM",
    );
    expect(risk.isKnownCustodian).toBe(true);
    expect(risk.custodianName).toBe("Kraken");
    expect(risk.recommendedMemoType).toBe("id");
    expect(memoWarningCopy(risk, undefined)).toContain("Kraken");
    expect(memoWarningCopy(risk, "12345")).toBeNull();
  });

  it("treats unknown destinations as safe", () => {
    expect(memoRiskFor("GUNKNOWN").isKnownCustodian).toBe(false);
    expect(memoRiskFor(undefined).isKnownCustodian).toBe(false);
  });

  it("validates memos against the Stellar memo spec", () => {
    expect(validateMemo("none", "").ok).toBe(true);
    expect(validateMemo("none", "x").ok).toBe(false);
    expect(validateMemo("text", "hello").ok).toBe(true);
    expect(validateMemo("text", "x".repeat(29)).ok).toBe(false);
    expect(validateMemo("id", "42").ok).toBe(true);
    expect(validateMemo("id", "-1").ok).toBe(false);
    expect(validateMemo("hash", "ab".repeat(32)).ok).toBe(true);
    expect(validateMemo("hash", "xyz").ok).toBe(false);
  });
});
