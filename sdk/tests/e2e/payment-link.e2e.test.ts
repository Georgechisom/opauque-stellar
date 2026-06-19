/**
 * End-to-end payment link: build a link from a meta-address, decode it back,
 * and confirm parameter validation and network/expiry guards.
 */
import { describe, it, expect } from "vitest";
import {
  createPaymentLink,
  decodePaymentLink,
  encodePaymentLink,
  isOpaquePaymentLink,
  isValidMetaAddress,
  convertLegacyLink,
} from "../../src/crypto/index";

const META = "0x" + "ab".repeat(66); // 66 bytes = 132 hex chars

describe("payment link (end to end)", () => {
  it("round-trips a link with parameters", () => {
    const link = createPaymentLink(META, "testnet", {
      amount: "10.5",
      label: "Coffee",
      expires: "2099-01-01T00:00:00Z",
    });
    expect(isOpaquePaymentLink(link)).toBe(true);

    const decoded = decodePaymentLink(link);
    expect("link" in decoded).toBe(true);
    if ("link" in decoded) {
      expect(decoded.link.metaAddress).toBe(META);
      expect(decoded.link.network).toBe("testnet");
      expect(decoded.link.params.amount).toBe("10.5");
      expect(decoded.link.params.label).toBe("Coffee");
    }
  });

  it("flags a network mismatch against the configured network", () => {
    const link = createPaymentLink(META, "mainnet");
    const decoded = decodePaymentLink(link, "testnet");
    expect("error" in decoded).toBe(true);
    if ("error" in decoded) expect(decoded.error.type).toBe("NETWORK_MISMATCH");
  });

  it("rejects an invalid meta-address and an expired link", () => {
    expect(isValidMetaAddress("0x1234")).toBe(false);
    expect(() => encodePaymentLink({ version: 1, network: "testnet", metaAddress: "0x12", params: {} })).toThrow();

    const expired = createPaymentLink(META, "testnet", { expires: "2000-01-01T00:00:00Z" });
    const decoded = decodePaymentLink(expired);
    expect("error" in decoded).toBe(true);
    if ("error" in decoded) expect(decoded.error.type).toBe("INVALID_PARAMETER");
  });

  it("converts a legacy https pay link", () => {
    const converted = convertLegacyLink(`https://pay.example.com/pay/${META}`, "testnet");
    expect(converted).not.toBeNull();
    expect(isOpaquePaymentLink(converted!)).toBe(true);
  });
});
