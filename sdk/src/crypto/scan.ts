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
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "./bytes";

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
 * View-only scan match — identifies incoming transfers without reconstructing
 * the spend key. The caller can later request the spend key to sweep.
 */
export interface ViewOnlyMatch {
  announcement: StealthAnnouncement;
  /** Stealth address derived from view key + spend pub key. */
  derivedStealthAddress: string;
}

/**
 * Derive the stealth address using view key and spending public key
 * without needing the spending private key.
 */
function deriveStealthAddressViewOnly(
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
): string {
  const CURVE = secp256k1;
  const n = CURVE.CURVE.n;

  // Shared secret: s = viewPriv * ephemeralPub
  const ephPoint = CURVE.ProjectivePoint.fromHex(ephemeralPubKey);
  const viewScalar = BigInt(`0x${bytesToHex(viewingKey)}`) % n;
  if (viewScalar === 0n) throw new Error("Invalid view scalar");
  const sharedPoint = ephPoint.multiply(viewScalar);
  const sharedSecret = sharedPoint.toRawBytes(true);

  // Hash shared secret
  const sH = keccak_256(sharedSecret);
  const sHScalar = BigInt(`0x${bytesToHex(sH)}`) % n;
  if (sHScalar === 0n) throw new Error("Invalid hash scalar");

  // S_h = sH * G
  const S_h = CURVE.ProjectivePoint.BASE.multiply(sHScalar);

  // P_stealth = P_spend + S_h
  const P_spend = CURVE.ProjectivePoint.fromHex(spendingPubKey);
  const P_stealth = P_spend.add(S_h);

  // Address from uncompressed pubkey
  const uncompressed = P_stealth.toRawBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  return "0x" + bytesToHex(hash.slice(12));
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

/**
 * View-only scan: identifies incoming transfers using only the viewing key
 * and spending public key. Does NOT load or reconstruct spend keys.
 *
 * Use this for least-privilege scanning — keep spend keys cold until sweep.
 */
export function scanAnnouncementsViewOnly(opts: {
  announcements: StealthAnnouncement[];
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
}): ViewOnlyMatch[] {
  const matches: ViewOnlyMatch[] = [];
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

    // Derive expected stealth address without reconstructing spend key
    const derivedAddress = deriveStealthAddressViewOnly(
      opts.viewingKey,
      opts.spendingPubKey,
      announcement.ephemeralPubKey,
    );

    if (derivedAddress.toLowerCase() !== announcement.stealthAddress.toLowerCase()) {
      continue;
    }

    matches.push({
      announcement,
      derivedStealthAddress: derivedAddress,
    });
  }
  return matches;
}
