import type { RelayerMessage } from "./messages.ts";

export const GOSSIP_TOPIC = "opaque/jobs/v1";

export interface GossipTransport {
  publish(message: RelayerMessage): Promise<void>;
  subscribe(handler: (message: RelayerMessage) => Promise<void> | void): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-memory transport used by tests and by single-node HTTP-only deployments.
 * A production libp2p GossipSub adapter implements the same interface.
 */
export class MemoryGossipTransport implements GossipTransport {
  private handlers = new Set<(message: RelayerMessage) => Promise<void> | void>();

  async publish(message: RelayerMessage): Promise<void> {
    await Promise.all(Array.from(this.handlers, (handler) => handler(message)));
  }

  async subscribe(handler: (message: RelayerMessage) => Promise<void> | void): Promise<void> {
    this.handlers.add(handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
