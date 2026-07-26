import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { rpc, xdr } from "@stellar/stellar-sdk";
import type { ContractInvoker, InvokeOptions, ReadOptions } from "./client";

/** Single recorded interaction for deterministic replay. */
export interface FixtureRecord {
  key: string;
  type: "invoke" | "readNative" | "simulateRead" | "getEvents" | "getLatestLedger" | "version";
  contractId?: string;
  method?: string;
  args?: unknown[];
  result: unknown;
  txHash?: string;
}

/**
 * A ContractInvoker that records every interaction into a fixture file.
 * Wrap a real invoker (or RpcClient) and call {@link save} to persist.
 */
export class RecordingInvoker implements ContractInvoker {
  readonly records: FixtureRecord[] = [];

  constructor(private readonly inner: ContractInvoker) {}

  async invoke(opts: InvokeOptions): Promise<string> {
    const txHash = await this.inner.invoke(opts);
    this.records.push({
      key: fixtureKey(opts.contractId, opts.method, opts.args),
      type: "invoke",
      contractId: opts.contractId,
      method: opts.method,
      args: opts.args.map(scrubScVal),
      result: txHash,
      txHash,
    });
    return txHash;
  }

  async readNative<T = unknown>(opts: ReadOptions): Promise<T> {
    const result = await this.inner.readNative<T>(opts);
    this.records.push({
      key: fixtureKey(opts.contractId, opts.method, opts.args),
      type: "readNative",
      contractId: opts.contractId,
      method: opts.method,
      args: opts.args.map(scrubScVal),
      result,
    });
    return result;
  }

  async simulateRead(opts: ReadOptions): Promise<xdr.ScVal | undefined> {
    const result = await this.inner.simulateRead(opts);
    this.records.push({
      key: fixtureKey(opts.contractId, opts.method, opts.args),
      type: "simulateRead",
      contractId: opts.contractId,
      method: opts.method,
      args: opts.args.map(scrubScVal),
      result: result ? result.toXDR("base64") : undefined,
    });
    return result;
  }

  async getEvents(request: rpc.Server.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    const result = await this.inner.getEvents(request);
    this.records.push({
      key: "getEvents",
      type: "getEvents",
      args: [request],
      result: result,
    });
    return result;
  }

  async getLatestLedger(): Promise<number> {
    const result = await this.inner.getLatestLedger();
    this.records.push({
      key: "getLatestLedger",
      type: "getLatestLedger",
      result,
    });
    return result;
  }

  /** Serialise recorded fixture records to a JSON file (scrubbed for commit). */
  save(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.records, null, 2), "utf8");
  }
}

/**
 * A ContractInvoker that replays responses from a pre-recorded fixture file.
 * Throws when a call does not match any known fixture entry.
 * Call {@link detectDrift} to verify the fixture still matches live responses.
 */
export class ReplayInvoker implements ContractInvoker {
  private readonly index: Map<string, FixtureRecord>;
  readonly fixturePath: string;

  constructor(fixturePath: string)
  constructor(records: FixtureRecord[])
  constructor(recordsOrPath: FixtureRecord[] | string) {
    if (typeof recordsOrPath === "string") {
      this.fixturePath = recordsOrPath;
      const raw = JSON.parse(readFileSync(recordsOrPath, "utf8")) as FixtureRecord[];
      this.index = new Map(raw.map((r) => [r.key, r]));
    } else {
      this.fixturePath = "";
      this.index = new Map(recordsOrPath.map((r) => [r.key, r]));
    }
  }

  async invoke(opts: InvokeOptions): Promise<string> {
    const key = fixtureKey(opts.contractId, opts.method, opts.args);
    const record = this.index.get(key);
    if (!record) throw new FixtureNotFoundError(key);
    return record.result as string;
  }

  async readNative<T = unknown>(opts: ReadOptions): Promise<T> {
    const key = fixtureKey(opts.contractId, opts.method, opts.args);
    const record = this.index.get(key);
    if (!record) throw new FixtureNotFoundError(key);
    return record.result as T;
  }

  async simulateRead(_opts: ReadOptions): Promise<xdr.ScVal | undefined> {
    return undefined;
  }

  async getEvents(_request: rpc.Server.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    const record = this.index.get("getEvents");
    if (!record) throw new FixtureNotFoundError("getEvents");
    return record.result as rpc.Api.GetEventsResponse;
  }

  async getLatestLedger(): Promise<number> {
    const record = this.index.get("getLatestLedger");
    if (!record) throw new FixtureNotFoundError("getLatestLedger");
    return record.result as number;
  }
}

/** Error thrown when a fixture for a call is not found. */
export class FixtureNotFoundError extends Error {
  readonly fixtureKey: string;
  constructor(key: string) {
    super(`No fixture found for key: ${key}`);
    this.name = "FixtureNotFoundError";
    this.fixtureKey = key;
  }
}

/**
 * Generate a deterministic fixture lookup key from contract method invocation
 * details. Uses JSON stringification of scrubbed arguments so the key is stable
 * across runs and can be read in a fixture file.
 */
function fixtureKey(contractId: string, method: string, args: readonly unknown[]): string {
  const scrubbed = args.map(scrubScVal);
  return `${contractId}::${method}::${JSON.stringify(scrubbed)}`;
}

/** Convert ScVal to a JSON-safe representation for fixture keys/storage. */
function scrubScVal(arg: unknown): unknown {
  if (arg instanceof xdr.ScVal) {
    try {
      return `scval:${arg.toXDR("base64")}`;
    } catch {
      return String(arg);
    }
  }
  if (arg instanceof Uint8Array || arg instanceof Buffer) {
    return `0x${Buffer.from(arg).toString("hex")}`;
  }
  if (typeof arg === "bigint") return arg.toString();
  if (Array.isArray(arg)) return arg.map(scrubScVal);
  if (arg && typeof arg === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(arg as Record<string, unknown>)) {
      obj[k] = scrubScVal(v);
    }
    return obj;
  }
  return arg;
}

/**
 * Compare a live invoker's responses against a fixture file.
 * Returns an array of drift descriptions (empty = fixture is current).
 */
export async function detectFixtureDrift(
  live: ContractInvoker,
  fixturePath: string,
): Promise<string[]> {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureRecord[];
  const drifts: string[] = [];
  for (const record of raw) {
    try {
      if (record.type === "readNative" && record.contractId && record.method) {
        const liveResult = await live.readNative({
          source: "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU",
          contractId: record.contractId,
          method: record.method,
          args: [],
        });
        if (JSON.stringify(liveResult) !== JSON.stringify(record.result)) {
          drifts.push(`${record.key}: result changed`);
        }
      }
    } catch {
      drifts.push(`${record.key}: query failed`);
    }
  }
  return drifts;
}
