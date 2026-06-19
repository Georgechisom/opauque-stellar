/**
 * Bindings for the schema-registry and attestation-engine-v2 contracts:
 * register / deprecate schemas, manage delegates, attest, and revoke.
 */
import { StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import type { ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import {
  addressToScVal,
  boolToScVal,
  bytesToScVal,
  optionAddressToScVal,
  stringToScVal,
  u32ToScVal,
} from "../rpc/scval";

export class SchemaRegistry {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Register a schema. The signer is the schema authority. */
  async registerSchema(opts: {
    schemaId: Uint8Array;
    name: string;
    fieldDefinitions: string;
    revocable: boolean;
    version?: number;
    resolver?: string | null;
    schemaExpiryLedger: number;
    signer: OpaqueSigner;
  }): Promise<string> {
    const authority = await opts.signer.publicKey();
    const authorityKey = StrKey.decodeEd25519PublicKey(authority);
    return this.rpc.invoke({
      source: authority,
      contractId: this.contractId,
      method: "register_schema",
      contractPackage: "schema-registry",
      args: [
        addressToScVal(authority),
        nativeToScVal(Buffer.from(authorityKey), { type: "bytes" }),
        bytesToScVal(opts.schemaId),
        stringToScVal(opts.name),
        stringToScVal(opts.fieldDefinitions),
        boolToScVal(opts.revocable),
        u32ToScVal(opts.version ?? 1),
        optionAddressToScVal(opts.resolver ?? null),
        u32ToScVal(opts.schemaExpiryLedger),
      ],
      signer: opts.signer,
    });
  }

  async deprecateSchema(opts: {
    schemaId: Uint8Array;
    signer: OpaqueSigner;
  }): Promise<string> {
    const authority = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: authority,
      contractId: this.contractId,
      method: "deprecate_schema",
      contractPackage: "schema-registry",
      args: [addressToScVal(authority), bytesToScVal(opts.schemaId)],
      signer: opts.signer,
    });
  }

  async addDelegate(opts: {
    schemaId: Uint8Array;
    delegate: string;
    signer: OpaqueSigner;
  }): Promise<string> {
    this.assertDelegate(opts.delegate);
    const authority = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: authority,
      contractId: this.contractId,
      method: "add_delegate",
      contractPackage: "schema-registry",
      args: [
        addressToScVal(authority),
        bytesToScVal(opts.schemaId),
        addressToScVal(opts.delegate),
      ],
      signer: opts.signer,
    });
  }

  async removeDelegate(opts: {
    schemaId: Uint8Array;
    delegate: string;
    signer: OpaqueSigner;
  }): Promise<string> {
    this.assertDelegate(opts.delegate);
    const authority = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: authority,
      contractId: this.contractId,
      method: "remove_delegate",
      contractPackage: "schema-registry",
      args: [
        addressToScVal(authority),
        bytesToScVal(opts.schemaId),
        addressToScVal(opts.delegate),
      ],
      signer: opts.signer,
    });
  }

  private assertDelegate(delegate: string): void {
    if (!StrKey.isValidEd25519PublicKey(delegate)) {
      throw new Error("Delegate must be a valid Stellar account address (G...).");
    }
  }
}

export class AttestationEngine {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Attest to a stealth identity under a schema. The signer is the issuer. */
  async attest(opts: {
    schemaId: Uint8Array;
    stealthAddressHash: Uint8Array;
    data: Uint8Array;
    expirationLedger: number;
    refUid: Uint8Array;
    signer: OpaqueSigner;
  }): Promise<string> {
    const issuer = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: issuer,
      contractId: this.contractId,
      method: "attest",
      contractPackage: "attestation-engine-v2",
      args: [
        addressToScVal(issuer),
        bytesToScVal(opts.schemaId),
        bytesToScVal(opts.stealthAddressHash),
        bytesToScVal(opts.data),
        u32ToScVal(opts.expirationLedger),
        bytesToScVal(opts.refUid),
      ],
      signer: opts.signer,
    });
  }

  async revokeAttestation(opts: {
    uid: Uint8Array;
    signer: OpaqueSigner;
  }): Promise<string> {
    const revoker = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: revoker,
      contractId: this.contractId,
      method: "revoke_attestation",
      contractPackage: "attestation-engine-v2",
      args: [addressToScVal(revoker), bytesToScVal(opts.uid)],
      signer: opts.signer,
    });
  }
}
