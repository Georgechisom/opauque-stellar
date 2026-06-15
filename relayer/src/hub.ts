import type { RelayerEngine } from "./engine.ts";
import type { GossipTransport } from "./gossip.ts";
import {
  validateAdvert,
  validateBid,
  validateRelayerMessage,
  validatePayload,
  type EncryptedPayload,
  type JobAdvert,
  type RelayerBid,
  type RelayerMessage,
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
  private subscribers = new Set<(message: RelayerMessage) => Promise<void> | void>();
  private started = false;

  constructor(private readonly transport: GossipTransport) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.transport.subscribe(async (message) => {
      try {
        const valid = validateRelayerMessage(message);
        if (valid.t === "advert") {
          this.stats.advertsSeen += 1;
        } else if (valid.t === "bid") {
          this.rememberBid(valid);
          this.stats.bidsSeen += 1;
        } else if (valid.t === "payload") {
          this.stats.payloadsSeen += 1;
        }
        await Promise.all(Array.from(this.subscribers, (handler) => handler(valid)));
      } catch (err) {
        this.stats.lastError = err instanceof Error ? err.message : String(err);
      }
    });
  }

  bidsFor(jobId: string): RelayerBid[] {
    return this.bids.get(jobId.toLowerCase()) ?? [];
  }

  async handleAdvert(advert: JobAdvert): Promise<null> {
    await this.publishGossipMessage(validateAdvert(advert));
    return null;
  }

  async handlePayload(payload: EncryptedPayload): Promise<null> {
    await this.publishGossipMessage(validatePayload(payload));
    return null;
  }

  async publishGossipMessage(message: RelayerMessage): Promise<void> {
    await this.start();
    await this.transport.publish(validateRelayerMessage(message));
  }

  subscribeGossip(handler: (message: RelayerMessage) => Promise<void> | void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
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
