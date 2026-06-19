/**
 * Pure-TS DKSAP announcement scanner. Given a set of announcements and the
 * recipient's viewing/spending keys, returns the transfers addressed to the
 * recipient with their reconstructed one-time keys. No WASM, no network: the
 * caller supplies the announcements (e.g. read from the stealth-announcer
 * contract events).
 */
import {
  checkViewTagMatch,
  deriveStealthStellarAddressFromStealthPrivKey,
  reconstructStealthPrivateKey,
  stealthIdFromPrivateKey,
} from "./dksap";

export interface StealthAnnouncement {
  /** 20-byte EVM-style stealth id (`0x` + 40 hex). */
  stealthAddress: string;
  /** Sender's compressed ephemeral public key (33 bytes). */
  ephemeralPubKey: Uint8Array;
  /** View tag byte from the announcement metadata. */
  viewTag: number;
}

export interface ScanMatch {
  announcement: StealthAnnouncement;
  /** Reconstructed one-time stealth private key (32 bytes). */
  stealthPrivKey: Uint8Array;
  /** Deterministic Stellar account holding the funds. */
  stealthStellarAddress: string;
}

/**
 * Scan announcements for transfers to the recipient. Each candidate is
 * view-tag prefiltered, then confirmed by reconstructing the one-time key and
 * checking its stealth id equals the announced one (so a coincidental tag match
 * is rejected).
 */
export function scanAnnouncements(opts: {
  announcements: StealthAnnouncement[];
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
}): ScanMatch[] {
  const matches: ScanMatch[] = [];
  for (const announcement of opts.announcements) {
    if (
      !checkViewTagMatch({
        viewingKey: opts.viewingKey,
        ephemeralPubKey: announcement.ephemeralPubKey,
        viewTag: announcement.viewTag,
      })
    ) {
      continue;
    }
    const stealthPrivKey = reconstructStealthPrivateKey({
      viewingKey: opts.viewingKey,
      spendingKey: opts.spendingKey,
      ephemeralPubKey: announcement.ephemeralPubKey,
    });
    if (
      stealthIdFromPrivateKey(stealthPrivKey).toLowerCase() !==
      announcement.stealthAddress.toLowerCase()
    ) {
      continue;
    }
    matches.push({
      announcement,
      stealthPrivKey,
      stealthStellarAddress: deriveStealthStellarAddressFromStealthPrivKey(stealthPrivKey),
    });
  }
  return matches;
}
