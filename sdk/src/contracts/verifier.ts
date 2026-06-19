/**
 * Binding for the groth16-verifier contract: verify a V2 reputation proof
 * on-chain (4 public signals as an ScMap). The caller (signer) is the tx source;
 * the proof inputs are the only call arguments.
 */
import { nativeToScVal } from "@stellar/stellar-sdk";
import type { ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import { bytesToScVal } from "../rpc/scval";

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
