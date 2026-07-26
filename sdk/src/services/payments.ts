/**
 * Stealth private payments. Derive an identity and meta-address, register it,
 * send a stealth XLM payment (one-time account + announcement), and sweep a
 * detected stealth account. `scan()` matches against a caller-supplied
 * announcement list; `scanIterator()` reads announcements from chain itself
 * and streams matches incrementally with a resumable cursor.
 */
import {
  computeStealthAddressAndViewTag,
  deriveKeysFromSignature,
  deriveStealthStellarKeypairFromStealthPrivKey,
  hexToBytes,
  keysToStealthMetaAddress,
  parseXlmToStroops,
  scanAnnouncements,
  stealthMetaAddressToHex,
  type Hex,
  type ScanMatch,
  type StealthAnnouncement,
} from "../crypto/index";
import { keypairSigner } from "../signer/index";
import type { OpaqueClientContext } from "./context";

export interface StealthIdentity {
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
  metaAddress: Uint8Array;
  metaHex: Hex;
}

export class PaymentsService {
  constructor(private readonly ctx: OpaqueClientContext) {}

  /** Derive viewing/spending keys + meta-address from a wallet signature. */
  deriveIdentity(signatureHex: string): StealthIdentity {
    const { viewingKey, spendingKey } = deriveKeysFromSignature(signatureHex);
    const { metaAddress } = keysToStealthMetaAddress(viewingKey, spendingKey);
    return {
      viewingKey,
      spendingKey,
      metaAddress,
      metaHex: stealthMetaAddressToHex(metaAddress),
    };
  }

  /** Register a stealth meta-address for the signer's account. */
  async register(opts: { metaAddress: Uint8Array }): Promise<string> {
    return this.ctx.contracts.stealthRegistry.registerKeys({
      stealthMetaAddress: opts.metaAddress,
      signer: this.ctx.requireSigner(),
    });
  }

  /** Pure: compute a one-time stealth address + announcement params for a recipient. */
  prepareTransfer(recipientMetaHex: string) {
    return computeStealthAddressAndViewTag(recipientMetaHex);
  }

  /**
   * Send a stealth XLM payment: pay the one-time stealth Stellar account, then
   * publish the announcement so the recipient can detect and sweep it.
   */
  async send(opts: {
    to: string;
    amountXlm: string;
  }): Promise<{
    stealthStellarAddress: string;
    ephemeralPubKey: Uint8Array;
    paymentTxHash: string;
    announceTxHash: string;
  }> {
    const signer = this.ctx.requireSigner();
    const stealth = computeStealthAddressAndViewTag(opts.to);
    const amountStroops = parseXlmToStroops(opts.amountXlm);

    const paymentTxHash = await this.ctx.sendNativeTransfer({
      destination: stealth.stealthStellarAddress,
      amountStroops,
      signer,
    });
    const announceTxHash = await this.ctx.contracts.stealthAnnouncer.announce({
      stealthAddress: hexToBytes(stealth.stealthAddress),
      ephemeralPubKey: stealth.ephemeralPubKey,
      metadata: stealth.metadata,
      signer,
    });
    return {
      stealthStellarAddress: stealth.stealthStellarAddress,
      ephemeralPubKey: stealth.ephemeralPubKey,
      paymentTxHash,
      announceTxHash,
    };
  }

  /**
   * Sweep a detected stealth account to a destination. The stealth account signs
   * itself (derived from the one-time key), so the connected wallet is never the
   * source. `amountStroops` is the exact amount to move (compute the spendable
   * balance from Horizon, reserving fee + minimum balance).
   */
  async sweep(opts: {
    stealthPrivKey: Uint8Array;
    destination: string;
    amountStroops: bigint;
  }): Promise<string> {
    const keypair = deriveStealthStellarKeypairFromStealthPrivKey(opts.stealthPrivKey);
    return this.ctx.sendNativeTransfer({
      destination: opts.destination,
      amountStroops: opts.amountStroops,
      signer: keypairSigner(keypair),
    });
  }

  /**
   * Scan announcements for transfers addressed to `identity`, returning each
   * match with its reconstructed one-time key and Stellar account. The caller
   * supplies the announcements (read from the stealth-announcer contract events).
   */
  scan(opts: {
    announcements: StealthAnnouncement[];
    identity: Pick<StealthIdentity, "viewingKey" | "spendingKey">;
  }): ScanMatch[] {
    return scanAnnouncements({
      announcements: opts.announcements,
      viewingKey: opts.identity.viewingKey,
      spendingKey: opts.identity.spendingKey,
    });
  }

  /**
   * Stream announcement matches from chain instead of waiting for the full
   * range to resolve: each match yields as soon as it is found, and the
   * *last processed* ledger persists to the configured `ScanStore` after
   * every page so a caller can resume mid-range later without re-reading (and
   * re-yielding) events already seen. Stop early (`break` out of the
   * `for await`) to release the scan without reading further pages.
   */
  async *scanIterator(opts: {
    identity: Pick<StealthIdentity, "viewingKey" | "spendingKey">;
    /** Resume from this ledger instead of the persisted cursor. */
    startLedger?: number;
    /** Skip reading/writing the persisted cursor (default false). */
    skipCursor?: boolean;
  }): AsyncGenerator<ScanMatch & { ledger: number }> {
    let startLedger = opts.startLedger;
    if (startLedger == null && !opts.skipCursor) {
      const cursor = await this.ctx.scanStore.getCursor();
      // The stored cursor is the last *processed* ledger; resume after it so
      // its events are not re-fetched (`getEvents`' startLedger is inclusive).
      if (cursor != null) startLedger = cursor + 1;
    }

    for await (const page of this.ctx.contracts.stealthAnnouncer.scanEvents({ startLedger })) {
      for (const match of scanAnnouncements({
        announcements: page.announcements,
        viewingKey: opts.identity.viewingKey,
        spendingKey: opts.identity.spendingKey,
      })) {
        yield { ...match, ledger: page.ledger };
      }
      if (!opts.skipCursor) await this.ctx.scanStore.setCursor(page.ledger);
    }
  }
}
