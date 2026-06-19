/**
 * End-to-end announcement scanning: a sender produces announcements for a
 * recipient meta-address; the recipient's scan finds exactly its own transfers
 * (with the right reconstructed Stellar account) and ignores others.
 */
import { describe, it, expect } from "vitest";
import {
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  computeStealthAddressAndViewTag,
  scanAnnouncements,
  type StealthAnnouncement,
} from "../../src/crypto/index";

function identity(sig: string) {
  const { viewingKey, spendingKey } = deriveKeysFromSignature(sig);
  const { metaAddress } = keysToStealthMetaAddress(viewingKey, spendingKey);
  return { viewingKey, spendingKey, metaHex: stealthMetaAddressToHex(metaAddress) };
}

function announcementFor(metaHex: string): {
  ann: StealthAnnouncement;
  stellar: string;
} {
  const s = computeStealthAddressAndViewTag(metaHex);
  return {
    ann: {
      stealthAddress: s.stealthAddress,
      ephemeralPubKey: s.ephemeralPubKey,
      viewTag: s.viewTag,
    },
    stellar: s.stealthStellarAddress,
  };
}

describe("announcement scanning (end to end)", () => {
  it("finds the recipient's own transfers and reconstructs the account", () => {
    const me = identity("0x" + "a1".repeat(64));
    const other = identity("0x" + "b2".repeat(64));

    const mine1 = announcementFor(me.metaHex);
    const mine2 = announcementFor(me.metaHex);
    const notMine = announcementFor(other.metaHex);

    const matches = scanAnnouncements({
      announcements: [mine1.ann, notMine.ann, mine2.ann],
      viewingKey: me.viewingKey,
      spendingKey: me.spendingKey,
    });

    expect(matches.length).toBe(2);
    const found = matches.map((m) => m.stealthStellarAddress).sort();
    expect(found).toEqual([mine1.stellar, mine2.stellar].sort());
    // Reconstructed key controls the announced stealth account.
    for (const m of matches) {
      expect(m.stealthPrivKey.length).toBe(32);
      expect(m.stealthStellarAddress).toMatch(/^G[A-Z2-7]{55}$/);
    }
  });

  it("returns nothing for a stranger's keys", () => {
    const me = identity("0x" + "a1".repeat(64));
    const stranger = identity("0x" + "cc".repeat(64));
    const mine = announcementFor(me.metaHex);

    const matches = scanAnnouncements({
      announcements: [mine.ann],
      viewingKey: stranger.viewingKey,
      spendingKey: stranger.spendingKey,
    });
    expect(matches).toEqual([]);
  });

  it("rejects a coincidental view-tag match (confirms by stealth id)", () => {
    const me = identity("0x" + "a1".repeat(64));
    const mine = announcementFor(me.metaHex);
    // Same view tag, but a different (random) stealth id -> must not match.
    const spoofed: StealthAnnouncement = {
      stealthAddress: "0x" + "ff".repeat(20),
      ephemeralPubKey: mine.ann.ephemeralPubKey,
      viewTag: mine.ann.viewTag,
    };
    const matches = scanAnnouncements({
      announcements: [spoofed],
      viewingKey: me.viewingKey,
      spendingKey: me.spendingKey,
    });
    expect(matches).toEqual([]);
  });
});
