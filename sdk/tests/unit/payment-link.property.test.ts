/**
 * Property-based tests for payment link encoder/decoder round-trip invariants
 * and malformed input rejection using fast-check.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createPaymentLink,
  decodePaymentLink,
  encodePaymentLink,
  isValidMetaAddress,
  isValidNetwork,
  isValidAmount,
  isValidStellarPublicKey,
  isValidAssetCode,
  isValidIso8601,
  isValidUrl,
  type Network,
  type PaymentLinkParams,
  type PaymentLink,
} from "../../src/crypto/index";

describe("payment link (property tests)", () => {
  describe("round-trip invariants", () => {
    it("round-trips valid links 1000+ times", () => {
      const metaAddressArb = fc
        .hexaString({ minLength: 132, maxLength: 132 })
        .map((hex) => "0x" + hex);

      const networkArb = fc.constantFrom<Network>("testnet", "mainnet", "futurenet", "local");

      const amountArb = fc
        .tuple(fc.integer({ min: 1, max: 999999 }), fc.integer({ min: 0, max: 18 }))
        .map(([whole, decimals]) => {
          if (decimals === 0) return whole.toString();
          return `${whole}.${String(decimals).padStart(2, "0")}`;
        });

      const linkArb = fc
        .record({
          metaAddress: metaAddressArb,
          network: networkArb,
          amount: fc.option(amountArb),
          label: fc.option(fc.string({ maxLength: 50 })),
        })
        .filter(({ metaAddress }) => isValidMetaAddress(metaAddress));

      fc.assert(
        fc.property(linkArb, ({ metaAddress, network, amount, label }) => {
          const originalLink = createPaymentLink(metaAddress, network, {
            amount,
            label,
          });

          expect(originalLink).toMatch(/^opaque:\/\/v1\//);

          const decoded = decodePaymentLink(originalLink);
          expect("link" in decoded).toBe(true);

          if ("link" in decoded) {
            expect(decoded.link.version).toBe(1);
            expect(decoded.link.network).toBe(network);
            expect(decoded.link.metaAddress).toBe(metaAddress);
            expect(decoded.link.params.amount).toBe(amount);
            expect(decoded.link.params.label).toBe(label);
          }
        }),
        { numRuns: 1000 },
      );
    });

    it("rejects malformed meta-addresses consistently", () => {
      const invalidMetaArb = fc
        .oneof(
          fc.string({ maxLength: 133 }),
          fc.hexaString().filter((s) => s.length !== 132),
          fc.string().filter((s) => !s.startsWith("0x")),
        )
        .filter((s) => !isValidMetaAddress(s));

      fc.assert(
        fc.property(invalidMetaArb, (invalidMeta) => {
          expect(() =>
            encodePaymentLink({
              version: 1,
              network: "testnet",
              metaAddress: invalidMeta,
              params: {},
            }),
          ).toThrow();
        }),
        { numRuns: 500 },
      );
    });

    it("rejects invalid amounts in decode", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const invalidAmountsArb = fc
        .oneof(
          fc.constantFrom("0", "-5", "abc", "", "-1.5", "1.2.3"),
          fc.string().filter((s) => !isValidAmount(s)),
        )
        .filter((a) => a.length > 0);

      fc.assert(
        fc.property(invalidAmountsArb, (invalidAmount) => {
          const link = `opaque://v1/testnet/${metaAddress}?amount=${encodeURIComponent(invalidAmount)}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("INVALID_PARAMETER");
          }
        }),
        { numRuns: 500 },
      );
    });

    it("rejects invalid Stellar public keys in issuer parameter", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const invalidKeyArb = fc
        .string({ minLength: 1, maxLength: 100 })
        .filter((s) => !isValidStellarPublicKey(s));

      fc.assert(
        fc.property(invalidKeyArb, (invalidKey) => {
          const link = `opaque://v1/testnet/${metaAddress}?issuer=${encodeURIComponent(invalidKey)}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("INVALID_PARAMETER");
          }
        }),
        { numRuns: 300 },
      );
    });

    it("rejects invalid asset codes", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const invalidAssetArb = fc
        .oneof(
          fc.constantFrom("", "A".repeat(13), "A@B", "A-B"),
          fc.string({ maxLength: 12 }).filter((s) => !isValidAssetCode(s)),
        )
        .filter((s) => s.length > 0 && s.length <= 12);

      fc.assert(
        fc.property(invalidAssetArb, (invalidAsset) => {
          const link = `opaque://v1/testnet/${metaAddress}?asset=${encodeURIComponent(invalidAsset)}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("INVALID_PARAMETER");
          }
        }),
        { numRuns: 300 },
      );
    });

    it("rejects invalid callback URLs (non-HTTPS)", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const invalidUrlArb = fc
        .oneof(
          fc.constantFrom("http://example.com", "ftp://example.com", "not-a-url", ""),
          fc
            .string({ maxLength: 50 })
            .filter((s) => {
              try {
                new URL(s);
                return false;
              } catch {
                return true;
              }
            }),
        )
        .filter((s) => s.length > 0);

      fc.assert(
        fc.property(invalidUrlArb, (invalidUrl) => {
          const link = `opaque://v1/testnet/${metaAddress}?callback=${encodeURIComponent(invalidUrl)}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("INVALID_PARAMETER");
          }
        }),
        { numRuns: 300 },
      );
    });

    it("rejects expired timestamps", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const pastDateArb = fc
        .date({ min: new Date("2000-01-01"), max: new Date("2023-12-31") })
        .map((d) => d.toISOString());

      fc.assert(
        fc.property(pastDateArb, (pastDate) => {
          const link = `opaque://v1/testnet/${metaAddress}?expires=${encodeURIComponent(pastDate)}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("INVALID_PARAMETER");
          }
        }),
        { numRuns: 500 },
      );
    });
  });

  describe("network binding invariants", () => {
    it("preserves network through encode/decode", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const networkArb = fc.constantFrom<Network>("testnet", "mainnet", "futurenet", "local");

      fc.assert(
        fc.property(networkArb, (network) => {
          const link = createPaymentLink(metaAddress, network);
          const decoded = decodePaymentLink(link);

          expect("link" in decoded).toBe(true);
          if ("link" in decoded) {
            expect(decoded.link.network).toBe(network);
          }
        }),
        { numRuns: 200 },
      );
    });

    it("detects network mismatches when configured network differs", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const networkPairArb = fc
        .tuple(
          fc.constantFrom<Network>("testnet", "mainnet", "futurenet", "local"),
          fc.constantFrom<Network>("testnet", "mainnet", "futurenet", "local"),
        )
        .filter(([n1, n2]) => n1 !== n2);

      fc.assert(
        fc.property(networkPairArb, ([linkNetwork, configuredNetwork]) => {
          const link = createPaymentLink(metaAddress, linkNetwork);
          const decoded = decodePaymentLink(link, configuredNetwork);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("NETWORK_MISMATCH");
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("malformed protocol rejection", () => {
    it("rejects non-opaque protocols", () => {
      const protocolArb = fc
        .string({ minLength: 1, maxLength: 10 })
        .filter((s) => s !== "opaque" && /^[a-z]+$/.test(s));

      fc.assert(
        fc.property(protocolArb, (protocol) => {
          const metaAddress = "0x" + "ab".repeat(66);
          const link = `${protocol}://v1/testnet/${metaAddress}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(decoded.error.type).toBe("INVALID_FORMAT");
          }
        }),
        { numRuns: 300 },
      );
    });

    it("rejects malformed version specifiers", () => {
      const metaAddress = "0x" + "ab".repeat(66);
      const malformedVersionArb = fc
        .oneof(
          fc.integer({ min: 2, max: 999 }).map((n) => `v${n}`),
          fc.constantFrom("version1", "1", "v", "vv1", "v1.0"),
        )
        .filter((s) => s !== "v1");

      fc.assert(
        fc.property(malformedVersionArb, (version) => {
          const link = `opaque://${version}/testnet/${metaAddress}`;
          const decoded = decodePaymentLink(link);

          expect("error" in decoded).toBe(true);
          if ("error" in decoded) {
            expect(["UNSUPPORTED_VERSION", "INVALID_FORMAT"]).toContain(decoded.error.type);
          }
        }),
        { numRuns: 300 },
      );
    });
  });
});
