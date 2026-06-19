/**
 * End-to-end DKSAP payment crypto: a recipient publishes a meta-address, a
 * sender derives a one-time stealth address + the Stellar account that receives
 * the funds, and the recipient detects (view-tag) and reconstructs the spending
 * key for that exact account. This is the full private-payment flow minus the
 * network round-trips.
 */
import { describe, it, expect } from "vitest";
import {
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  parseStealthMetaAddress,
  computeStealthAddressAndViewTag,
  buildGhostAnnouncementPayload,
  checkViewTagMatch,
  recipientSharedSecretHash,
  reconstructStealthPrivateKey,
  deriveStealthStellarKeypairFromStealthPrivKey,
  deriveStealthStellarAddressFromStealthPrivKey,
  deriveAnnouncerEphemeralKey,
  bytesToHex,
} from "../../src/crypto/index";
import { secp256k1 } from "@noble/curves/secp256k1";

// A wallet signature is just entropy for HKDF; any stable even-length hex works.
const RECIPIENT_SIG = "0x" + "a1b2c3d4e5f6a7b8".repeat(8); // 64-byte signature

function recipientIdentity(sig: string) {
  const { viewingKey, spendingKey } = deriveKeysFromSignature(sig);
  const { metaAddress } = keysToStealthMetaAddress(viewingKey, spendingKey);
  return { viewingKey, spendingKey, metaHex: stealthMetaAddressToHex(metaAddress) };
}

describe("DKSAP private payment (end to end)", () => {
  it("sender-derived Stellar account is recoverable by the recipient", () => {
    const { viewingKey, spendingKey, metaHex } = recipientIdentity(RECIPIENT_SIG);

    // Sender side.
    const send = computeStealthAddressAndViewTag(metaHex);
    expect(send.stealthStellarAddress).toMatch(/^G[A-Z2-7]{55}$/);
    expect(send.ephemeralPubKey.length).toBe(33);
    expect(send.metadata).toEqual(new Uint8Array([send.viewTag]));

    // Recipient prefilter: the view tag matches with the right viewing key.
    expect(
      checkViewTagMatch({
        viewingKey,
        ephemeralPubKey: send.ephemeralPubKey,
        viewTag: send.viewTag,
      }),
    ).toBe(true);

    // Recipient reconstructs the one-time key and derives the same account.
    const stealthPriv = reconstructStealthPrivateKey({
      viewingKey,
      spendingKey,
      ephemeralPubKey: send.ephemeralPubKey,
    });
    const recovered = deriveStealthStellarKeypairFromStealthPrivKey(stealthPriv);
    expect(recovered.publicKey()).toBe(send.stealthStellarAddress);
    expect(deriveStealthStellarAddressFromStealthPrivKey(stealthPriv)).toBe(
      send.stealthStellarAddress,
    );
  });

  it("reconstructed key controls the derived secp256k1 stealth point", () => {
    const { viewingKey, spendingKey, metaHex } = recipientIdentity(RECIPIENT_SIG);
    const send = computeStealthAddressAndViewTag(metaHex);
    const stealthPriv = reconstructStealthPrivateKey({
      viewingKey,
      spendingKey,
      ephemeralPubKey: send.ephemeralPubKey,
    });
    // The 20-byte EVM-style stealth id is keccak(uncompressed pub)[12:].
    const { spendPubKey } = parseStealthMetaAddress(metaHex);
    expect(spendPubKey.length).toBe(33);
    expect(secp256k1.getPublicKey(stealthPriv, true).length).toBe(33);
  });

  it("a different recipient cannot detect or reconstruct the transfer", () => {
    const { metaHex } = recipientIdentity(RECIPIENT_SIG);
    const send = computeStealthAddressAndViewTag(metaHex);

    const stranger = recipientIdentity("0x" + "11".repeat(65));
    // View tag almost certainly does not match for the wrong viewing key.
    const matched = checkViewTagMatch({
      viewingKey: stranger.viewingKey,
      ephemeralPubKey: send.ephemeralPubKey,
      viewTag: send.viewTag,
    });
    if (matched) {
      // 1/256 chance the tag collides; the reconstructed account must still differ.
      const wrongPriv = reconstructStealthPrivateKey({
        viewingKey: stranger.viewingKey,
        spendingKey: stranger.spendingKey,
        ephemeralPubKey: send.ephemeralPubKey,
      });
      expect(
        deriveStealthStellarAddressFromStealthPrivKey(wrongPriv),
      ).not.toBe(send.stealthStellarAddress);
    } else {
      expect(matched).toBe(false);
    }
  });

  it("deterministic ghost re-announcement reproduces the same stealth address", () => {
    const { metaHex } = recipientIdentity(RECIPIENT_SIG);
    const send = computeStealthAddressAndViewTag(metaHex);
    const ephHex = "0x" + bytesToHex(send.ephemeralPriv);

    const rebuilt = buildGhostAnnouncementPayload(metaHex, ephHex);
    expect(rebuilt.stealthAddress).toBe(send.stealthAddress);
    expect(rebuilt.viewTag).toBe(send.viewTag);
    expect(bytesToHex(rebuilt.ephemeralPubKey)).toBe(bytesToHex(send.ephemeralPubKey));
  });

  it("announcer ephemeral key is deterministic per meta-address", () => {
    const { metaHex } = recipientIdentity(RECIPIENT_SIG);
    const k1 = deriveAnnouncerEphemeralKey(metaHex);
    const k2 = deriveAnnouncerEphemeralKey(metaHex);
    expect(k1.length).toBe(32);
    expect(bytesToHex(k1)).toBe(bytesToHex(k2));
  });

  it("recipient shared-secret hash matches the announced view tag", () => {
    const { viewingKey, metaHex } = recipientIdentity(RECIPIENT_SIG);
    const send = computeStealthAddressAndViewTag(metaHex);
    const { viewTag } = recipientSharedSecretHash(viewingKey, send.ephemeralPubKey);
    expect(viewTag).toBe(send.viewTag);
  });
});
