/**
 * Binding for the privacy-pool contract: deposit, withdraw (with a v3 proof),
 * and admin root publishing. Deposits and withdrawals are permissionless; the
 * signer's account is the tx source.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ContractInvoker, SimulationReport } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import { NotWiredError } from "../errors/index";
import {
  addressToScVal,
  boolToScVal,
  bytesToScVal,
  i128ToScVal,
  u64ToScVal,
} from "../rpc/scval";

const POOL_EVENT_LOOKBACK = 16_000;

/** Parse the "ledger range: X - Y" hint from a getEvents range error. */
function parseOldestLedgerFromRangeError(err: unknown): number | null {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown })?.message === "string"
          ? (err as { message: string }).message
          : "";
  const m = /ledger range:\s*(\d+)\s*-\s*(\d+)/.exec(msg);
  return m ? Number(m[1]) : null;
}

/** Live on-chain pool configuration, as read by `get_config`. */
export interface PoolConfig {
  admin: string;
  groth16Verifier: string;
  nativeSac: string;
  scope: number;
  rootExpiryLedgers: number;
}

export interface PoolWithdrawInputs {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  withdrawnValue: bigint;
  stateRoot: Uint8Array;
  aspRoot: Uint8Array;
  nullifierHash: Uint8Array;
  newCommitment: Uint8Array;
  recipient: string;
  fee: bigint;
  relayer: string;
}

export class PrivacyPool {
  constructor(
    private readonly rpc: ContractInvoker,
    readonly contractId: string,
  ) {}

  /** Deposit `value` stroops under a precomputed commitment at `expectedIndex`. */
  async deposit(opts: {
    value: bigint;
    commitment: Uint8Array;
    expectedIndex: number;
    signer: OpaqueSigner;
  }): Promise<string> {
    const depositor = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: depositor,
      contractId: this.contractId,
      method: "deposit",
      contractPackage: "privacy-pool",
      args: [
        addressToScVal(depositor),
        i128ToScVal(opts.value),
        bytesToScVal(opts.commitment),
        u64ToScVal(BigInt(opts.expectedIndex)),
      ],
      signer: opts.signer,
    });
  }

  private withdrawArgs(opts: PoolWithdrawInputs): xdr.ScVal[] {
    return [
      bytesToScVal(opts.proofA),
      bytesToScVal(opts.proofB),
      bytesToScVal(opts.proofC),
      i128ToScVal(opts.withdrawnValue),
      bytesToScVal(opts.stateRoot),
      bytesToScVal(opts.aspRoot),
      bytesToScVal(opts.nullifierHash),
      bytesToScVal(opts.newCommitment),
      addressToScVal(opts.recipient),
      i128ToScVal(opts.fee),
      addressToScVal(opts.relayer),
    ];
  }

  /** Withdraw to `recipient` (minus `fee` to `relayer`) with a v3 proof. */
  async withdraw(
    opts: PoolWithdrawInputs & { signer: OpaqueSigner },
  ): Promise<string> {
    const caller = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: caller,
      contractId: this.contractId,
      method: "withdraw",
      contractPackage: "privacy-pool",
      args: this.withdrawArgs(opts),
      signer: opts.signer,
    });
  }

  /**
   * Dry-run a withdrawal: builds and simulates the same transaction `withdraw`
   * would submit, but never signs or sends it, so no nullifier is consumed.
   * Requires an invoker that implements `simulateInvoke`.
   */
  async simulateWithdraw(
    opts: PoolWithdrawInputs & { source: string },
  ): Promise<SimulationReport> {
    if (!this.rpc.simulateInvoke) {
      throw new NotWiredError(
        "Withdrawal dry run",
        "The configured invoker does not implement simulateInvoke.",
      );
    }
    return this.rpc.simulateInvoke({
      source: opts.source,
      contractId: this.contractId,
      method: "withdraw",
      args: this.withdrawArgs(opts),
    });
  }

  /** Publish a tree root (admin only). `kind` selects the state vs ASP root. */
  async updateRoot(opts: {
    kind: "state" | "asp";
    root: Uint8Array;
    datasetHash: Uint8Array;
    signer: OpaqueSigner;
  }): Promise<string> {
    const admin = await opts.signer.publicKey();
    return this.rpc.invoke({
      source: admin,
      contractId: this.contractId,
      method: opts.kind === "state" ? "update_state_root" : "update_asp_root",
      contractPackage: "privacy-pool",
      args: [
        addressToScVal(admin),
        bytesToScVal(opts.root),
        bytesToScVal(opts.datasetHash),
      ],
      signer: opts.signer,
    });
  }

  /** Read the pool's live on-chain configuration (`get_config`). */
  async getConfig(source: string): Promise<PoolConfig> {
    const raw = await this.rpc.readNative<Record<string, unknown>>({
      source,
      contractId: this.contractId,
      method: "get_config",
      args: [],
    });
    return {
      admin: String(raw.admin),
      groth16Verifier: String(raw.groth16_verifier),
      nativeSac: String(raw.native_sac),
      scope: Number(raw.scope),
      rootExpiryLedgers: Number(raw.root_expiry_ledgers),
    };
  }

  /**
   * Read the decimal precision of the pool's backing asset (its native SAC's
   * `decimals()`), by way of the live pool config rather than an assumed constant.
   */
  async getNativeAssetDecimals(source: string): Promise<number> {
    const config = await this.getConfig(source);
    const decimals = await this.rpc.readNative<number>({
      source,
      contractId: config.nativeSac,
      method: "decimals",
      args: [],
    });
    return Number(decimals);
  }

  /** Read the next deposit leaf index (the value `deposit` will assign). */
  async getDepositCount(source: string): Promise<number> {
    const count = await this.rpc.readNative<number | bigint>({
      source,
      contractId: this.contractId,
      method: "get_deposit_count",
      args: [],
    });
    return Number(count);
  }

  /** Read the latest published state (or ASP) root, or null if none. */
  async getLatestRoot(opts: {
    source: string;
    kind: "state" | "asp";
  }): Promise<Uint8Array | null> {
    const root = await this.rpc.readNative<Uint8Array | undefined>({
      source: opts.source,
      contractId: this.contractId,
      method: "get_latest_root",
      args: [boolToScVal(opts.kind === "state")],
    });
    return root ? Uint8Array.from(root) : null;
  }

  /**
   * Reconstruct the pool's commitment leaves from on-chain events. Returns the
   * commitment at each state-tree index (`stateLeaves`, deposits + withdrawal
   * remainders) and the state index of each deposit in event order
   * (`depositIndices`, == ASP-tree order). Feed these into the withdrawal prover.
   */
  async reconstructState(opts?: {
    startLedger?: number;
  }): Promise<{ stateLeaves: bigint[]; depositIndices: number[] }> {
    const latest = await this.rpc.getLatestLedger();
    let startLedger =
      opts?.startLedger && opts.startLedger > 0
        ? opts.startLedger
        : Math.max(1, latest - POOL_EVENT_LOOKBACK);

    const depositTopic = xdr.ScVal.scvSymbol("Deposit").toXDR("base64");
    const withdrawTopic = xdr.ScVal.scvSymbol("Withdraw").toXDR("base64");
    const byIndex = new Map<number, bigint>();
    const depositIndices: number[] = [];

    for (const [topic, isDeposit] of [
      [depositTopic, true],
      [withdrawTopic, false],
    ] as const) {
      let cursor: string | undefined;
      let prevCursor: string | undefined;
      const filters = [
        { type: "contract" as const, contractIds: [this.contractId], topics: [[topic, "*"]] },
      ];
      // getEvents pages ~10k ledgers at a time and returns empty pages before
      // the ones holding events; follow the cursor until it stops advancing.
      for (let page = 0; page < 200; page++) {
        let res;
        try {
          res = await this.rpc.getEvents(
            cursor ? { cursor, filters, limit: 100 } : { startLedger, filters, limit: 100 },
          );
        } catch (err) {
          const oldest = parseOldestLedgerFromRangeError(err);
          if (!cursor && oldest != null && startLedger < oldest) {
            startLedger = oldest;
            res = await this.rpc.getEvents({ startLedger, filters, limit: 100 });
          } else {
            throw err;
          }
        }
        for (const ev of res.events ?? []) {
          const data = scValToNative(ev.value) as unknown[];
          if (isDeposit) {
            const commitment = BigInt(
              "0x" + Buffer.from(data[0] as Uint8Array).toString("hex"),
            );
            const index = Number(data[1]);
            byIndex.set(index, commitment);
            depositIndices.push(index);
          } else {
            const newCommitment = BigInt(
              "0x" + Buffer.from(data[1] as Uint8Array).toString("hex"),
            );
            byIndex.set(Number(data[2]), newCommitment);
          }
        }
        cursor = res.cursor;
        if (!cursor || cursor === prevCursor) break;
        prevCursor = cursor;
      }
    }

    const max = byIndex.size === 0 ? -1 : Math.max(...byIndex.keys());
    const stateLeaves: bigint[] = [];
    for (let i = 0; i <= max; i++) stateLeaves.push(byIndex.get(i) ?? 0n);
    depositIndices.sort((a, b) => a - b);
    return { stateLeaves, depositIndices };
  }
}
