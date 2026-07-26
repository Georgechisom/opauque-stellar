import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import {
  OpaqueClient,
  keypairSigner,
  type ContractInvoker,
  type InvokeOptions,
  type ReadOptions,
} from "../../src/index";

const ALLOWLIST_PATH = resolve(import.meta.dirname, "../egress-allowlist.json");
const ALLOWLIST: string[] = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).hosts;

const signer = keypairSigner(Keypair.random());

/**
 * Stub invoker that records all calls but makes no network requests.
 * Used here so the service flows exercise the SDK logic without real egress.
 */
class EgressSafeInvoker implements ContractInvoker {
  calls: string[] = [];
  reads: Record<string, unknown> = {};

  async invoke(opts: InvokeOptions): Promise<string> {
    this.calls.push(`invoke:${opts.contractId}:${opts.method}`);
    return "TXHASH";
  }

  async readNative<T = unknown>(opts: ReadOptions): Promise<T> {
    this.calls.push(`read:${opts.contractId}:${opts.method}`);
    const key = `${opts.contractId}::${opts.method}`;
    if (key in this.reads) return this.reads[key] as T;
    return 42 as T;
  }

  async simulateRead(): Promise<xdr.ScVal | undefined> {
    return undefined;
  }

  async getEvents(): Promise<rpc.Api.GetEventsResponse> {
    return { events: [], latestLedger: 0, cursor: "" } as unknown as rpc.Api.GetEventsResponse;
  }

  async getLatestLedger(): Promise<number> {
    return 3101000;
  }
}

/**
 * Minimal egress monitor that wraps the Node.js fetch to verify
 * every URL hostname is in the allowlist. We install it before running
 * service flows and check that no disallowed egress occurred.
 */
class EgressMonitor {
  private originalFetch: typeof globalThis.fetch;
  contacted: string[] = [];
  violations: string[] = [];

  install(): void {
    this.originalFetch = globalThis.fetch;
    const monitor = this;
    globalThis.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = url;
      }
      monitor.contacted.push(hostname);
      if (!ALLOWLIST.includes(hostname)) {
        monitor.violations.push(hostname);
      }
      return monitor.originalFetch(input, init);
    };
  }

  restore(): void {
    globalThis.fetch = this.originalFetch;
  }
}

describe("network egress allowlist", () => {
  let monitor: EgressMonitor;
  let invoker: EgressSafeInvoker;
  let client: OpaqueClient;

  beforeEach(() => {
    monitor = new EgressMonitor();
    monitor.install();
    invoker = new EgressSafeInvoker();
    client = new OpaqueClient({
      network: "testnet",
      signer,
      invoker,
      skipVersionCheck: true,
    });
  });

  afterEach(() => {
    monitor.restore();
  });

  it("no egress during OpaqueClient construction", () => {
    expect(monitor.contacted.length).toBe(0);
    expect(monitor.violations).toEqual([]);
  });

  it("no egress during payments service ops", async () => {
    const id = client.payments.deriveIdentity("0x" + "ab".repeat(64));
    await client.payments.register({ metaAddress: id.metaAddress });
    const scanned = client.payments.scan({ announcements: [], identity: id });
    expect(scanned).toEqual([]);

    expect(monitor.violations).toEqual([]);
  });

  it("no egress during pool service ops", async () => {
    invoker.reads["CAYXZTWB26VPIO6UTKFM22UY6XIMO72IRCFKAU2C6NSMQ4JSJ6VJ7BLE::get_deposit_count"] = 5;

    const { note, txHash } = await client.pool.deposit({ amountXlm: "5" });
    expect(txHash).toBe("TXHASH");
    expect(note.leafIndex).toBe(5);
    expect(note.value).toBe("50000000");

    expect(monitor.violations).toEqual([]);
  });

  it("no egress during reputation service ops", async () => {
    const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
    await client.reputation.verifyOnChain({
      proofA: bytes(64),
      proofB: bytes(128),
      proofC: bytes(64),
      merkleRoot: bytes(32, 1),
      attestationId: bytes(32, 2),
      externalNullifier: 42n,
      nullifierHash: bytes(32, 3),
    });

    expect(monitor.violations).toEqual([]);
  });

  it("no egress during relayer service ops", async () => {
    const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
    await client.relayer.createJob({
      jobId: bytes(32),
      payloadHash: bytes(32),
      deadlineLedger: 3_200_000,
      fee: 1_000_000n,
    });

    expect(monitor.violations).toEqual([]);
  });

  it("allowlist is not empty and contains testnet endpoints", () => {
    expect(ALLOWLIST.length).toBeGreaterThan(0);
    expect(ALLOWLIST).toContain("soroban-testnet.stellar.org");
    expect(ALLOWLIST).toContain("horizon-testnet.stellar.org");
  });
});
