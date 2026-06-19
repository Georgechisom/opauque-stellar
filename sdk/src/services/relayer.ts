/**
 * Relayer market: the wallet-side job lifecycle (create a blind withdrawal job,
 * cancel it, slash it). The gateway message flow (advert / bids / encrypted
 * payload delivery) needs the relayer-protocol module and is surfaced as a
 * not-wired capability in this build.
 */
import { NotWiredError } from "../errors/index";
import type { OpaqueClientContext } from "./context";

export class RelayerService {
  constructor(private readonly ctx: OpaqueClientContext) {}

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

  /** Gateway advert/bid/payload flow is not wired in this build. */
  useGateway(): never {
    throw new NotWiredError(
      "Relayer gateway client",
      "The advert/bid/encrypted-payload flow needs the relayer-protocol module.",
    );
  }
}
