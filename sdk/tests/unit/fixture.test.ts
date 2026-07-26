import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rpc, xdr } from "@stellar/stellar-sdk";
import {
  RecordingInvoker,
  ReplayInvoker,
  FixtureNotFoundError,
  detectFixtureDrift,
  type ContractInvoker,
  type InvokeOptions,
  type ReadOptions,
} from "../../src/index";

class StubFixtureInvoker implements ContractInvoker {
  invokeCalls = 0;
  readCalls = 0;
  callResults: Record<string, unknown> = {};

  async invoke(opts: InvokeOptions): Promise<string> {
    this.invokeCalls++;
    return "TXHASH";
  }

  async readNative<T>(opts: ReadOptions): Promise<T> {
    this.readCalls++;
    const key = `${opts.contractId}::${opts.method}`;
    if (key in this.callResults) return this.callResults[key] as T;
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

describe("fixture recording and replay", () => {
  let tmpDir: string;
  let inner: StubFixtureInvoker;
  let recorder: RecordingInvoker;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fixture-test-"));
    inner = new StubFixtureInvoker();
    recorder = new RecordingInvoker(inner);
  });

  it("records and replays readNative calls", async () => {
    const r1 = await recorder.readNative({
      source: "GABC",
      contractId: "CA",
      method: "get_deposit_count",
      args: [],
    });
    expect(r1).toBe(42);

    const fixturePath = join(tmpDir, "fixture.json");
    recorder.save(fixturePath);

    const replay = new ReplayInvoker(fixturePath);
    const r2 = await replay.readNative({
      source: "GABC",
      contractId: "CA",
      method: "get_deposit_count",
      args: [],
    });
    expect(r2).toBe(42);
  });

  it("replays invoke calls with the recorded tx hash", async () => {
    const txHash = await recorder.invoke({
      source: "GABC",
      contractId: "CA",
      method: "deposit",
      args: [],
      signer: {} as any,
    });
    expect(txHash).toBe("TXHASH");

    const fixturePath = join(tmpDir, "fixture2.json");
    recorder.save(fixturePath);

    const replay = new ReplayInvoker(fixturePath);
    const replayed = await replay.invoke({
      source: "GABC",
      contractId: "CA",
      method: "deposit",
      args: [],
      signer: {} as any,
    });
    expect(replayed).toBe("TXHASH");
  });

  it("throws FixtureNotFoundError for unknown calls during replay", async () => {
    const fixturePath = join(tmpDir, "empty.json");
    writeFileSync(fixturePath, "[]", "utf8");
    const replay = new ReplayInvoker(fixturePath);
    await expect(
      replay.readNative({ source: "G", contractId: "CX", method: "unknown", args: [] }),
    ).rejects.toBeInstanceOf(FixtureNotFoundError);
  });

  it("records and replays getLatestLedger", async () => {
    const ledger = await recorder.getLatestLedger();
    expect(ledger).toBe(3101000);

    const fixturePath = join(tmpDir, "ledger.json");
    recorder.save(fixturePath);

    const replay = new ReplayInvoker(fixturePath);
    expect(await replay.getLatestLedger()).toBe(3101000);
  });

  it("constructs ReplayInvoker from in-memory records", async () => {
    await recorder.readNative({ source: "G", contractId: "C", method: "read", args: [] });
    const replay = new ReplayInvoker(recorder.records);
    const result = await replay.readNative({ source: "G", contractId: "C", method: "read", args: [] });
    expect(result).toBe(42);
  });

  it("detects drift when live results differ from fixture", async () => {
    await recorder.readNative({ source: "G", contractId: "C", method: "drift_test", args: [] });
    const fixturePath = join(tmpDir, "drift.json");
    recorder.save(fixturePath);

    const altered = new StubFixtureInvoker();
    altered.callResults["C::drift_test"] = 99;

    const drifts = await detectFixtureDrift(altered, fixturePath);
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts[0]).toContain("drift_test");
  });

  it("produces no drift when live results match fixture", async () => {
    await recorder.readNative({ source: "G", contractId: "C", method: "stable", args: [] });
    const fixturePath = join(tmpDir, "stable.json");
    recorder.save(fixturePath);

    const same = new StubFixtureInvoker();
    same.callResults["C::stable"] = 42;

    const drifts = await detectFixtureDrift(same, fixturePath);
    expect(drifts).toEqual([]);
  });
});
