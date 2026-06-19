/**
 * Bindings for the stealth-registry and stealth-announcer contracts: publish a
 * meta-address and announce a one-time stealth transfer.
 */
import type { ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import { addressToScVal, bytesToScVal, u64ToScVal } from "../rpc/scval";

/** secp256k1 stealth scheme id, as registered on-chain. */
export const SCHEME_ID_SECP256K1 = 1n;

export class StealthRegistry {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Register a stealth meta-address for the signer's account. */
  async registerKeys(opts: {
    stealthMetaAddress: Uint8Array;
    schemeId?: bigint;
    signer: OpaqueSigner;
  }): Promise<string> {
    const source = await opts.signer.publicKey();
    return this.rpc.invoke({
      source,
      contractId: this.contractId,
      method: "register_keys",
      contractPackage: "stealth-registry",
      args: [
        addressToScVal(source),
        u64ToScVal(opts.schemeId ?? SCHEME_ID_SECP256K1),
        bytesToScVal(opts.stealthMetaAddress),
      ],
      signer: opts.signer,
    });
  }
}

export class StealthAnnouncer {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Announce a one-time stealth transfer (stealth id + ephemeral key + view tag). */
  async announce(opts: {
    stealthAddress: Uint8Array;
    ephemeralPubKey: Uint8Array;
    metadata: Uint8Array;
    schemeId?: bigint;
    signer: OpaqueSigner;
  }): Promise<string> {
    const source = await opts.signer.publicKey();
    return this.rpc.invoke({
      source,
      contractId: this.contractId,
      method: "announce",
      contractPackage: "stealth-announcer",
      args: [
        addressToScVal(source),
        u64ToScVal(opts.schemeId ?? SCHEME_ID_SECP256K1),
        bytesToScVal(opts.stealthAddress),
        bytesToScVal(opts.ephemeralPubKey),
        bytesToScVal(opts.metadata),
      ],
      signer: opts.signer,
    });
  }
}
