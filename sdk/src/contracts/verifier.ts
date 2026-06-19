/**
 * Binding for the groth16-verifier contract: verify a V2 reputation proof
 * on-chain (4 public signals as an ScMap). The caller (signer) is the tx source;
 * the proof inputs are the only call arguments.
 */
import { nativeToScVal } from "@stellar/stellar-sdk";
import type { ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import {
  addressToScVal,
  bytesToScVal,
  u32ToScVal,
  u64ToScVal,
} from "../rpc/scval";

export interface VerifyProofV2Inputs {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  merkleRoot: Uint8Array;
  attestationId: Uint8Array;
  externalNullifier: Uint8Array;
  nullifierHash: Uint8Array;
}

export class Groth16Verifier {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Submit a Groth16 V2 proof. The public signals are passed as an ScMap. */
  async verifyProofV2(
    opts: VerifyProofV2Inputs & { signer: OpaqueSigner },
  ): Promise<string> {
    const source = await opts.signer.publicKey();
    return this.rpc.invoke({
      source,
      contractId: this.contractId,
      method: "verify_proof_v2",
      contractPackage: "groth16-verifier",
      args: [
        bytesToScVal(opts.proofA),
        bytesToScVal(opts.proofB),
        bytesToScVal(opts.proofC),
        nativeToScVal(
          {
            merkle_root: Buffer.from(opts.merkleRoot),
            attestation_id: Buffer.from(opts.attestationId),
            external_nullifier: Buffer.from(opts.externalNullifier),
            nullifier_hash: Buffer.from(opts.nullifierHash),
          },
          { type: "map" },
        ),
      ],
      signer: opts.signer,
    });
  }
}

export interface VerifyReputationInputs {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  merkleRoot: Uint8Array;
  attestationId: Uint8Array;
  externalNullifier: bigint;
  nullifierHash: Uint8Array;
  expirationLedger?: number;
}

/**
 * High-level reputation-verifier binding. `verify_reputation` enforces root
 * validity + nullifier-replay protection and calls the groth16-verifier; this is
 * the on-chain entry point for proving reputation (vs. the lower-level
 * {@link Groth16Verifier}).
 */
export class ReputationVerifier {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Submit a V2 reputation proof for on-chain verification. */
  async verifyReputation(
    opts: VerifyReputationInputs & {
      groth16VerifierId: string;
      signer: OpaqueSigner;
    },
  ): Promise<string> {
    const caller = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: caller,
      contractId: this.contractId,
      method: "verify_reputation",
      contractPackage: "reputation-verifier",
      args: [
        addressToScVal(caller),
        addressToScVal(opts.groth16VerifierId),
        bytesToScVal(opts.proofA),
        bytesToScVal(opts.proofB),
        bytesToScVal(opts.proofC),
        bytesToScVal(opts.merkleRoot),
        bytesToScVal(opts.attestationId),
        u64ToScVal(opts.externalNullifier),
        bytesToScVal(opts.nullifierHash),
        u32ToScVal(opts.expirationLedger ?? 0),
      ],
      signer: opts.signer,
    });
  }

  /** Read the latest published reputation Merkle root (bytes), or null if none. */
  async getLatestRoot(source: string): Promise<Uint8Array | null> {
    const root = await this.rpc.readNative<Uint8Array | undefined>({
      source,
      contractId: this.contractId,
      method: "get_latest_root",
      args: [],
    });
    if (!root) return null;
    const bytes = Uint8Array.from(root);
    return bytes.every((b) => b === 0) ? null : bytes;
  }
}
