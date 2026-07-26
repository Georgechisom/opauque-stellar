import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import {
  OpaqueClient,
  ReplayInvoker,
  RecordingInvoker,
  keypairSigner,
  TESTNET_DEPLOYMENT,
  type ContractInvoker,
  type InvokeOptions,
  type ReadOptions,
} from "../../src/index";

const FIXTURE_PATH = resolve(import.meta.dirname, "../fixtures/testnet-v1.json");
const signer = keypairSigner(Keypair.random());

class SimpleStub implements ContractInvoker {
  async invoke(_opts: InvokeOptions): Promise<string> { return "TXHASH"; }
  async readNative<T = unknown>(_opts: ReadOptions): Promise<T> { return 7 as T; }
  async simulateRead(): Promise<xdr.ScVal | undefined> { return undefined; }
  async getEvents(): Promise<rpc.Api.GetEventsResponse> {
    return { events: [], latestLedger: 0, cursor: "" } as unknown as rpc.Api.GetEventsResponse;
  }
  async getLatestLedger(): Promise<number> { return 3101000; }
}

describe("fixture replay integration", () => {
  it("loads fixture file and runs OpaqueClient flows", async () => {
    const invoker = new ReplayInvoker(FIXTURE_PATH);
    const client = new OpaqueClient({
      network: "testnet",
      signer,
      invoker,
      skipVersionCheck: true,
    });

    expect(client.config.network).toBe("testnet");
    expect(client.contracts.stealthRegistry.contractId).toBe(
      TESTNET_DEPLOYMENT.contracts.stealthRegistry,
    );
    expect(client.payments).toBeDefined();
    expect(client.pool).toBeDefined();

    const count = await client.pool.getDepositCount({
      source: "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU",
    });
    expect(count).toBe(42);
  });

  it("record and replay produces matching results", async () => {
    const inner = new SimpleStub();
    const recorder = new RecordingInvoker(inner);

    const val = await recorder.readNative({
      source: "G",
      contractId: "C",
      method: "test",
      args: [],
    });
    expect(val).toBe(7);

    expect(recorder.records.length).toBe(1);
    expect(recorder.records[0].key).toBe("C::test::[]");

    const replay = new ReplayInvoker(recorder.records);
    const replayed = await replay.readNative({
      source: "G",
      contractId: "C",
      method: "test",
      args: [],
    });
    expect(replayed).toBe(7);
  });

  it("recording captures invoke and getLatestLedger", async () => {
    const inner = new SimpleStub();
    const recorder = new RecordingInvoker(inner);

    const txHash = await recorder.invoke({
      source: "G",
      contractId: "C",
      method: "deposit",
      args: [],
      signer: {} as any,
    });
    expect(txHash).toBe("TXHASH");

    const ledger = await recorder.getLatestLedger();
    expect(ledger).toBe(3101000);

    expect(recorder.records.length).toBe(2);
    expect(recorder.records[0].type).toBe("invoke");
    expect(recorder.records[1].type).toBe("getLatestLedger");
  });
});
