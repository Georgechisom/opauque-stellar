/**
 * Relayer market: the wallet-side withdrawal flow. Build a blind withdrawal
 * payload from a pool proof, create the on-chain escrow job, advertise it,
 * collect and verify bids, pick a relayer, and deliver the encrypted payload.
 */
import {
  RelayerGateway,
  buildRelayedWithdrawPayload,
  buildRelayerJobDraft,
  pickStakeWeightedBid,
  type PoolWithdrawPayload,
  type RelayerBid,
  type RelayerJobDraft,
  type RelayerJobStatus,
  type VerifiedBid,
} from "../relayer-protocol/index";
import type { PoolWithdrawProof } from "../prove/pool";
import type { OpaqueClientContext } from "./context";

export class RelayerService {
  constructor(private readonly ctx: OpaqueClientContext) {}

  private gateway(): RelayerGateway {
    return new RelayerGateway({
      gatewayUrls: this.ctx.config.relayerGatewayUrls,
      registryId: this.ctx.config.contracts.relayerRegistry,
      invoker: this.ctx.rpc,
    });
  }

  // --- on-chain job lifecycle -------------------------------------------------

  /** Create a blind withdrawal job (escrows the fee on-chain). */
  async createJob(opts: {
    jobId: Uint8Array;
    payloadHash: Uint8Array;
    deadlineLedger: number;
    fee: bigint;
  }): Promise<string> {
    return this.ctx.contracts.relayerRegistry.createJob({
      ...opts,
      signer: this.ctx.requireSigner(),
    });
  }

  /** Create the on-chain job for a built draft. */
  async createJobForDraft(draft: RelayerJobDraft): Promise<string> {
    return this.createJob({
      jobId: draft.jobId,
      payloadHash: draft.payloadHash,
      deadlineLedger: draft.deadlineLedger,
      fee: draft.fee,
    });
  }

  /** Cancel a never-accepted job after its deadline (refunds the escrow fee). */
  async cancelJob(opts: { jobId: Uint8Array }): Promise<string> {
    return this.ctx.contracts.relayerRegistry.cancelJob({
      ...opts,
      signer: this.ctx.requireSigner(),
    });
  }

  /** Slash an accepted-but-unsubmitted job after its deadline. */
  async slashJob(opts: { jobId: Uint8Array }): Promise<string> {
    return this.ctx.contracts.relayerRegistry.slashJob({
      ...opts,
      signer: this.ctx.requireSigner(),
    });
  }

  // --- payload + gateway ------------------------------------------------------

  /** Build the blind withdrawal payload from a pool proof. */
  buildWithdrawPayload(opts: {
    proof: PoolWithdrawProof;
    recipient: string;
  }): PoolWithdrawPayload {
    return buildRelayedWithdrawPayload({
      poolId: this.ctx.config.contracts.privacyPool,
      registryId: this.ctx.config.contracts.relayerRegistry,
      proof: opts.proof,
      recipient: opts.recipient,
    });
  }

  /** Build a job draft (job id, payload hash, advert) from a payload. */
  buildJobDraft(opts: {
    payload: PoolWithdrawPayload;
    fee: bigint;
    deadlineLedger: number;
    jobId?: Uint8Array;
  }): RelayerJobDraft {
    return buildRelayerJobDraft(opts);
  }

  /** A deadline `ledgers` ahead of the current ledger. */
  async deadlineLedger(ledgers?: number): Promise<number> {
    return this.gateway().deadlineLedger(ledgers);
  }

  /** Advertise a job to the gateway. */
  async advertise(draft: RelayerJobDraft): Promise<void> {
    return this.gateway().publishAdvert(draft.advert);
  }

  /** Fetch and verify bids for a job (signature + on-chain registry state). */
  async fetchBids(jobIdHex: string): Promise<VerifiedBid[]> {
    return this.gateway().fetchBids(jobIdHex);
  }

  /** Stake-weighted random choice among verified bids. */
  pickBid(bids: VerifiedBid[]): VerifiedBid | null {
    return pickStakeWeightedBid(bids);
  }

  /** Encrypt the payload to the chosen relayer and deliver it to the gateway. */
  async deliverPayload(args: {
    draft: RelayerJobDraft;
    bid: RelayerBid;
  }): Promise<{ acceptedTx?: string; submittedTx?: string } | null> {
    return this.gateway().deliverPayload(args);
  }

  /** Read a job's on-chain status. */
  async jobStatus(jobIdHex: string, source?: string): Promise<RelayerJobStatus> {
    const src = source ?? (await this.ctx.requireSigner().publicKey());
    return this.gateway().jobStatus(jobIdHex, src);
  }
}
