/**
 * Binding for the privacy-pool contract: deposit, withdraw (with a v3 proof),
 * and admin root publishing. Deposits and withdrawals are permissionless; the
 * signer's account is the tx source.
 */
import type { ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import {
  addressToScVal,
  boolToScVal,
  bytesToScVal,
  i128ToScVal,
  u64ToScVal,
} from "../rpc/scval";

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
      args: [
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
      ],
      signer: opts.signer,
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
}
