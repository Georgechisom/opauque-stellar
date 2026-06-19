import { describe, it, expect } from "vitest";
import {
  addressToScVal,
  bytesToScVal,
  u32ToScVal,
  u64ToScVal,
  i128ToScVal,
  symbolToScVal,
  fromScVal,
} from "../../src/index";

const ADDR = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";
const CONTRACT = "CAIXWMGYZR3YAQ3CPCXOU42WG62E3ARUSG4GDHHDMNRXUD44YSGE5VXW";

describe("ScVal codecs", () => {
  it("round-trips a G-address", () => {
    expect(fromScVal(addressToScVal(ADDR))).toBe(ADDR);
  });

  it("round-trips a contract address", () => {
    expect(fromScVal(addressToScVal(CONTRACT))).toBe(CONTRACT);
  });

  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const decoded = fromScVal(bytesToScVal(bytes)) as Uint8Array;
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("round-trips integer types", () => {
    expect(fromScVal(u32ToScVal(4_000_000_000))).toBe(4_000_000_000);
    expect(fromScVal(u64ToScVal(18_446_744_073_709_551_610n))).toBe(
      18_446_744_073_709_551_610n,
    );
    expect(fromScVal(i128ToScVal(-12_345_678_901_234n))).toBe(-12_345_678_901_234n);
  });

  it("encodes a symbol", () => {
    expect(fromScVal(symbolToScVal("withdraw"))).toBe("withdraw");
  });
});
