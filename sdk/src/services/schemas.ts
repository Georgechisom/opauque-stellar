/**
 * Schema administration: register schemas, attest to stealth identities, revoke,
 * deprecate, and manage delegates. Schema ids and attestation payloads are
 * computed with the crypto codecs and submitted through the contract bindings.
 */
import {
  computeSchemaId,
  encodeAttestationData,
  parseFieldDefinitions,
} from "../crypto/index";
import type { OpaqueClientContext } from "./context";

export class SchemasService {
  constructor(private readonly ctx: OpaqueClientContext) {}

  /** Register a schema. The signer is the authority; returns the schema id. */
  async register(opts: {
    name: string;
    fieldDefinitions: string;
    revocable: boolean;
    version?: number;
    resolver?: string | null;
    schemaExpiryLedger: number;
  }): Promise<{ schemaId: Uint8Array; txHash: string }> {
    const signer = this.ctx.requireSigner();
    const authority = await signer.publicKey();
    const schemaId = await computeSchemaId(
      authority,
      opts.name,
      opts.fieldDefinitions,
      opts.version ?? 1,
    );
    const txHash = await this.ctx.contracts.schemaRegistry.registerSchema({
      schemaId,
      name: opts.name,
      fieldDefinitions: opts.fieldDefinitions,
      revocable: opts.revocable,
      version: opts.version,
      resolver: opts.resolver ?? null,
      schemaExpiryLedger: opts.schemaExpiryLedger,
      signer,
    });
    return { schemaId, txHash };
  }

  /** Attest to a stealth identity under a schema. The signer is the issuer. */
  async attest(opts: {
    schemaId: Uint8Array;
    stealthAddressHash: Uint8Array;
    fieldValues: Record<string, string>;
    fieldDefinitions: string;
    expirationLedger: number;
    refUid?: Uint8Array;
  }): Promise<string> {
    const signer = this.ctx.requireSigner();
    const fields = parseFieldDefinitions(opts.fieldDefinitions);
    const data = encodeAttestationData(opts.fieldValues, fields);
    return this.ctx.contracts.attestationEngine.attest({
      schemaId: opts.schemaId,
      stealthAddressHash: opts.stealthAddressHash,
      data,
      expirationLedger: opts.expirationLedger,
      refUid: opts.refUid ?? new Uint8Array(32),
      signer,
    });
  }

  async revoke(opts: { uid: Uint8Array }): Promise<string> {
    return this.ctx.contracts.attestationEngine.revokeAttestation({
      uid: opts.uid,
      signer: this.ctx.requireSigner(),
    });
  }

  async deprecate(opts: { schemaId: Uint8Array }): Promise<string> {
    return this.ctx.contracts.schemaRegistry.deprecateSchema({
      schemaId: opts.schemaId,
      signer: this.ctx.requireSigner(),
    });
  }

  async addDelegate(opts: { schemaId: Uint8Array; delegate: string }): Promise<string> {
    return this.ctx.contracts.schemaRegistry.addDelegate({
      ...opts,
      signer: this.ctx.requireSigner(),
    });
  }

  async removeDelegate(opts: { schemaId: Uint8Array; delegate: string }): Promise<string> {
    return this.ctx.contracts.schemaRegistry.removeDelegate({
      ...opts,
      signer: this.ctx.requireSigner(),
    });
  }
}
