import type { RelayerMessage } from "./messages.ts";

export const GOSSIP_TOPIC = "opaque/stellar/jobs/v1";

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

type GossipEnvelope = {
  topic: string;
  message: RelayerMessage;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function gatewayUrl(path: string, base: string): string {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  return url.toString();
}

export class HttpGossipTransport implements GossipTransport {
  private handlers = new Set<(message: RelayerMessage) => Promise<void> | void>();
  private abort: AbortController | null = null;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly gateway: string,
    private readonly topic = GOSSIP_TOPIC,
  ) {}

  async publish(message: RelayerMessage): Promise<void> {
    const res = await fetch(gatewayUrl("v1/gossip/messages", this.gateway), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: this.topic, message } satisfies GossipEnvelope),
    });
    if (!res.ok) throw new Error(`Gossip publish failed (${res.status}).`);
  }

  async subscribe(handler: (message: RelayerMessage) => Promise<void> | void): Promise<void> {
    this.handlers.add(handler);
    if (!this.ready) {
      this.abort = new AbortController();
      this.ready = this.readLoop(this.abort);
    }
    await this.ready;
  }

  async close(): Promise<void> {
    this.abort?.abort();
    this.abort = null;
    this.ready = null;
    this.handlers.clear();
  }

  private async readLoop(abort: AbortController): Promise<void> {
    let resolveReady: (() => void) | null = null;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    void this.streamUntilClosed(abort, () => {
      resolveReady?.();
      resolveReady = null;
    });
    return ready;
  }

  private async streamUntilClosed(abort: AbortController, markReady: () => void): Promise<void> {
    while (!abort.signal.aborted) {
      try {
        const res = await fetch(gatewayUrl("v1/gossip/stream", this.gateway), {
          signal: abort.signal,
        });
        markReady();
        if (!res.ok || !res.body) throw new Error(`Gossip stream failed (${res.status}).`);
        await this.readSse(res.body, abort);
      } catch (err) {
        markReady();
        if (abort.signal.aborted) return;
        await sleep(1000);
      }
    }
  }

  private async readSse(body: ReadableStream<Uint8Array>, abort: AbortController): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let split = buf.indexOf("\n\n");
        while (split >= 0) {
          const frame = buf.slice(0, split);
          buf = buf.slice(split + 2);
          await this.handleSseFrame(frame);
          split = buf.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async handleSseFrame(frame: string): Promise<void> {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const envelope = JSON.parse(data) as GossipEnvelope;
    if (envelope.topic !== this.topic) return;
    await Promise.all(Array.from(this.handlers, (handler) => handler(envelope.message)));
  }
}
