// @ts-nocheck
/**
 * Stellar/Soroban chain adapter: reads finalized `Deposit` events from the privacy-pool
 * contract and posts the association root via `update_asp_root`, signed by the ASP
 * authority keypair (the pool admin for the demo). Never run in CI — the engine is tested
 * against an in-memory fake adapter; this talks to a live network.
 */
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { ChainAdapter, Deposit } from "../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StellarAdapterConfig {
  rpcUrl: string;
  networkPassphrase: string;
  poolId: string;
  scope: number;
  authority: Keypair;
  confirmations?: number;
  /** Max ledgers to look back on a cold start (must stay within RPC event retention). */
  lookback?: number;
}

export class StellarChainAdapter implements ChainAdapter {
  private server: rpc.Server;
  constructor(private cfg: StellarAdapterConfig) {
    this.server = new rpc.Server(cfg.rpcUrl);
  }

  async latestLedger(): Promise<number> {
    return (await this.server.getLatestLedger()).sequence;
  }

  async readDeposits(afterIndex: number, fromLedger: number): Promise<Deposit[]> {
    const latest = await this.latestLedger();
    const lookback = this.cfg.lookback ?? 16000;
    const startLedger = fromLedger > 0 ? fromLedger : Math.max(1, latest - lookback);
    const depositTopic = xdr.ScVal.scvSymbol("Deposit").toXDR("base64");

    const deposits: Deposit[] = [];
    let cursor: string | undefined;
    // Page through events; the Deposit topic is 2 segments [Symbol, version], so the
    // filter is exactly 2 long (matches Soroban's exact-length topic rule).
    for (let page = 0; page < 20; page++) {
      const req: any = {
        filters: [{ type: "contract", contractIds: [this.cfg.poolId], topics: [[depositTopic, "*"]] }],
        limit: 100,
      };
      if (cursor) req.cursor = cursor;
      else req.startLedger = startLedger;
      const res = await this.server.getEvents(req);
      for (const ev of res.events ?? []) {
        const [commitment, index, value, scope] = scValToNative(ev.value);
        const idx = Number(index);
        if (idx <= afterIndex) continue;
        deposits.push({
          index: idx,
          commitment: "0x" + Buffer.from(commitment).toString("hex"),
          value: value.toString(),
          scope: Number(scope),
          ledger: ev.ledger,
        });
      }
      cursor = res.cursor;
      if (!res.events || res.events.length < 100) break;
    }
    deposits.sort((a, b) => a.index - b.index);
    return deposits;
  }

  async currentAspRoot(): Promise<string | null> {
    try {
      const acct = await this.server.getAccount(this.cfg.authority.publicKey());
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(new Contract(this.cfg.poolId).call("get_latest_root", xdr.ScVal.scvBool(false)))
        .setTimeout(30)
        .build();
      const sim = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) return null;
      const native = scValToNative(sim.result.retval);
      return "0x" + Buffer.from(native).toString("hex");
    } catch {
      return null;
    }
  }

  async postAspRoot(root: string, datasetHash: string): Promise<void> {
    const kp = this.cfg.authority;
    const acct = await this.server.getAccount(kp.publicKey());
    const toBytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ""), "hex"));
    let tx = new TransactionBuilder(acct, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(
        new Contract(this.cfg.poolId).call(
          "update_asp_root",
          new Address(kp.publicKey()).toScVal(),
          toBytes(root),
          toBytes(datasetHash),
        ),
      )
      .setTimeout(120)
      .build();
    tx = await this.server.prepareTransaction(tx);
    tx.sign(kp);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === "ERROR") {
      throw new Error(`update_asp_root rejected: ${JSON.stringify(sent.errorResult ?? sent)}`);
    }
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const r = await this.server.getTransaction(sent.hash);
      if (r.status === "SUCCESS") return;
      if (r.status === "FAILED") throw new Error(`update_asp_root FAILED ${sent.hash}`);
    }
    throw new Error("update_asp_root not confirmed");
  }
}
