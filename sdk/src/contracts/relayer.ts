/**
 * Binding for the relayer-registry contract job lifecycle the wallet drives:
 * create a blind withdrawal job (escrow fee), cancel it, or slash an
 * accepted-but-unsubmitted job after the deadline. Relayer-side methods
 * (register, accept, submit) live in the relayer node.
 */
import type { ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import { addressToScVal, bytesToScVal, i128ToScVal, u32ToScVal } from "../rpc/scval";

export class RelayerRegistry {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Create a blind job with an escrowed fee and a payload hash + deadline. */
  async createJob(opts: {
    jobId: Uint8Array;
    payloadHash: Uint8Array;
    deadlineLedger: number;
    fee: bigint;
    signer: OpaqueSigner;
  }): Promise<string> {
    const creator = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: creator,
      contractId: this.contractId,
      method: "create_job",
      contractPackage: "relayer-registry",
      args: [
        addressToScVal(creator),
        bytesToScVal(opts.jobId),
        bytesToScVal(opts.payloadHash),
        u32ToScVal(opts.deadlineLedger),
        i128ToScVal(opts.fee),
      ],
      signer: opts.signer,
    });
  }

  /** Cancel a never-accepted job after its deadline; refunds the escrow fee. */
  async cancelJob(opts: { jobId: Uint8Array; signer: OpaqueSigner }): Promise<string> {
    return this.jobAction("cancel_job", opts);
  }

  /** Slash an accepted-but-unsubmitted job after its deadline. */
  async slashJob(opts: { jobId: Uint8Array; signer: OpaqueSigner }): Promise<string> {
    return this.jobAction("slash_job", opts);
  }

  private async jobAction(
    method: "cancel_job" | "slash_job",
    opts: { jobId: Uint8Array; signer: OpaqueSigner },
  ): Promise<string> {
    const creator = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: creator,
      contractId: this.contractId,
      method,
      contractPackage: "relayer-registry",
      args: [addressToScVal(creator), bytesToScVal(opts.jobId)],
      signer: opts.signer,
    });
  }
}
