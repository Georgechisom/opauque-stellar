import { describe, it, expect } from "vitest";
import {
  parseXlmToStroops,
  formatStroopsToXlm,
  parseHorizonBalanceToStroops,
} from "../../src/crypto/index";

describe("XLM amount parsing", () => {
  it("parses and formats round-trip", () => {
    const cases: Array<[string, bigint]> = [
      ["1", 10_000_000n],
      ["1.5", 15_000_000n],
      ["0.0000001", 1n],
      ["100", 1_000_000_000n],
      ["0", 0n],
    ];
    for (const [xlm, stroops] of cases) {
      expect(parseXlmToStroops(xlm)).toBe(stroops);
      expect(formatStroopsToXlm(stroops)).toBe(xlm);
    }
  });

  it("rejects too many decimals and malformed input", () => {
    expect(() => parseXlmToStroops("0.00000001")).toThrow();
    expect(() => parseXlmToStroops("abc")).toThrow();
    expect(() => parseXlmToStroops("")).toThrow();
  });

  it("defensively parses Horizon balances", () => {
    expect(parseHorizonBalanceToStroops("100.0000000")).toBe(1_000_000_000n);
    expect(parseHorizonBalanceToStroops(undefined)).toBe(0n);
    expect(parseHorizonBalanceToStroops("garbage")).toBe(0n);
  });
});
