import type { RelayerEngine } from "./engine.ts";
import type { GossipTransport } from "./gossip.ts";
import {
  validateAdvert,
  validateBid,
  validatePayload,
  type EncryptedPayload,
  type JobAdvert,
  type RelayerBid,
} from "./messages.ts";

export type RelayerHubStats = {
  advertsSeen: number;
  bidsSeen: number;
  payloadsSeen: number;
  lastError: string | null;
};

export class RelayerHub {
  readonly stats: RelayerHubStats = {
    advertsSeen: 0,
    bidsSeen: 0,
    payloadsSeen: 0,
    lastError: null,
  };

  private bids = new Map<string, RelayerBid[]>();
  private started = false;

  constructor(private readonly transport: GossipTransport) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.transport.subscribe((message) => {
      try {
        if (message.t === "advert") {
          validateAdvert(message);
          this.stats.advertsSeen += 1;
        } else if (message.t === "bid") {
          this.rememberBid(validateBid(message));
          this.stats.bidsSeen += 1;
        } else if (message.t === "payload") {
          validatePayload(message);
          this.stats.payloadsSeen += 1;
        }
      } catch (err) {
        this.stats.lastError = err instanceof Error ? err.message : String(err);
      }
    });
  }

  bidsFor(jobId: string): RelayerBid[] {
    return this.bids.get(jobId.toLowerCase()) ?? [];
  }

  async handleAdvert(advert: JobAdvert): Promise<null> {
    await this.start();
    await this.transport.publish(validateAdvert(advert));
    return null;
  }

  async handlePayload(payload: EncryptedPayload): Promise<null> {
    await this.start();
    await this.transport.publish(validatePayload(payload));
    return null;
  }

  rememberBid(bid: RelayerBid): void {
    const key = bid.jobId.toLowerCase();
    const list = this.bids.get(key) ?? [];
    if (!list.some((b) => b.operator === bid.operator)) {
      list.push(bid);
      this.bids.set(key, list);
    }
  }
}

export async function attachRelayerEngineToGossip(
  engine: RelayerEngine,
  transport: GossipTransport,
): Promise<void> {
  await transport.subscribe(async (message) => {
    if (message.t === "advert") {
      const bid = await engine.handleAdvert(message);
      if (bid) await transport.publish(bid);
      return;
    }
    if (message.t === "bid") {
      engine.rememberBid(validateBid(message));
      return;
    }
    if (message.t === "payload") {
      await engine.handlePayload(message);
    }
  });
}
