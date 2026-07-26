/**
 * Privacy pool. Deposit (derive a note's commitment and persist the note),
 * withdraw with a precomputed proof, and read pool state (deposit count, roots).
 * Withdrawal proof *generation* needs the proving layer (snarkjs + circuit
 * artifacts) and is surfaced as a not-wired capability in this build: bring a
 * precomputed proof bundle to withdraw().
 */
import {
  bigIntToBytes32,
  deriveDeposit,
  newNoteSecrets,
  parseXlmToStroops,
  toHex32,
  type PoolNote,
} from "../crypto/index";
import { NotWiredError } from "../errors/index";
import { provePoolWithdraw, type PoolWithdrawProof } from "../prove/pool";
import type { SimulationReport } from "../rpc/client";
import { validateDepositAmount } from "./pool-validation";
import type { OpaqueClientContext } from "./context";

/** A withdrawal proof bundle (everything except the public recipient/fee/relayer). */
export type WithdrawProofBundle = PoolWithdrawProof;

export class PoolService {
  constructor(private readonly ctx: OpaqueClientContext) {}

  private async source(explicit?: string): Promise<string> {
    return explicit ?? (await this.ctx.requireSigner().publicKey());
  }

  /**
   * Deposit `amountXlm` into the pool. Reads the next leaf index, derives the
   * commitment from fresh (or provided) secrets, submits, and persists the note.
   */
  async deposit(opts: {
    amountXlm: string;
    secrets?: { nullifier: string; secret: string };
    createdAt?: number;
    /** Skip the pre-flight amount validation (default false). */
    skipValidation?: boolean;
  }): Promise<{ note: PoolNote; txHash: string }> {
    const signer = this.ctx.requireSigner();
    const source = await signer.publicKey();
    const scope = this.ctx.config.pool.scope;
    const value = parseXlmToStroops(opts.amountXlm);

    if (!opts.skipValidation) {
      const decimals = await this.ctx.contracts.privacyPool.getNativeAssetDecimals(source);
      validateDepositAmount({ amountXlm: opts.amountXlm, valueStroops: value, decimals });
    }

    const expectedIndex = await this.ctx.contracts.privacyPool.getDepositCount(source);
    const secrets = opts.secrets ?? newNoteSecrets();
    const { commitment } = await deriveDeposit({
      value,
      scope,
      leafIndex: expectedIndex,
      nullifier: BigInt(secrets.nullifier),
      secret: BigInt(secrets.secret),
    });

    const txHash = await this.ctx.contracts.privacyPool.deposit({
      value,
      commitment: bigIntToBytes32(commitment),
      expectedIndex,
      signer,
    });

    const note: PoolNote = {
      cluster: this.ctx.config.network,
      poolId: this.ctx.config.contracts.privacyPool,
      value: value.toString(),
      scope,
      leafIndex: expectedIndex,
      nullifier: secrets.nullifier,
      secret: secrets.secret,
      commitment: toHex32(commitment),
      spent: false,
      createdAt: opts.createdAt ?? 0,
    };
    await this.ctx.notes.add(note);
    return { note, txHash };
  }

  /** Withdraw using a precomputed proof bundle. Marks the note spent on success. */
  async withdraw(opts: {
    proof: WithdrawProofBundle;
    recipient: string;
    fee?: bigint;
    relayer?: string;
    /** Note commitment to mark spent once the withdrawal lands. */
    noteCommitment?: string;
  }): Promise<string> {
    const signer = this.ctx.requireSigner();
    const txHash = await this.ctx.contracts.privacyPool.withdraw({
      ...opts.proof,
      recipient: opts.recipient,
      fee: opts.fee ?? 0n,
      relayer: opts.relayer ?? opts.recipient,
      signer,
    });
    if (opts.noteCommitment) await this.ctx.notes.markSpent(opts.noteCommitment);
    return txHash;
  }

  /** Read the next deposit leaf index. */
  async getDepositCount(opts?: { source?: string }): Promise<number> {
    return this.ctx.contracts.privacyPool.getDepositCount(await this.source(opts?.source));
  }

  /** Read the latest published state and ASP roots (or null when unpublished). */
  async getRoots(opts?: {
    source?: string;
  }): Promise<{ state: Uint8Array | null; asp: Uint8Array | null }> {
    const source = await this.source(opts?.source);
    const [state, asp] = await Promise.all([
      this.ctx.contracts.privacyPool.getLatestRoot({ source, kind: "state" }),
      this.ctx.contracts.privacyPool.getLatestRoot({ source, kind: "asp" }),
    ]);
    return { state, asp };
  }

  /**
   * Generate a full-withdrawal proof for a note. Requires an artifact resolver
   * (`new OpaqueClient({ artifacts })`). The pool leaves are reconstructed from
   * on-chain Deposit/Withdraw events automatically; pass `stateLeaves` +
   * `depositIndices` to skip the on-chain read (e.g. in tests).
   */
  async proveWithdraw(opts: {
    note: PoolNote;
    recipient: string;
    relayer?: string;
    fee?: bigint;
    scope?: number;
    stateLeaves?: bigint[];
    depositIndices?: number[];
    /** Testing only: inject a stub in place of `snarkjs`. */
    snarkjs?: Parameters<typeof provePoolWithdraw>[0]["snarkjs"];
  }): Promise<PoolWithdrawProof> {
    if (!this.ctx.artifacts) {
      throw new NotWiredError(
        "Pool withdrawal proof generation",
        "Construct OpaqueClient with { artifacts } to enable proving, or pass a precomputed bundle to withdraw().",
      );
    }
    let { stateLeaves, depositIndices } = opts;
    if (!stateLeaves || !depositIndices) {
      const state = await this.ctx.contracts.privacyPool.reconstructState({
        startLedger: this.ctx.config.startLedger,
      });
      stateLeaves = state.stateLeaves;
      depositIndices = state.depositIndices;
    }
    return provePoolWithdraw({
      note: opts.note,
      recipient: opts.recipient,
      relayer: opts.relayer ?? opts.recipient,
      fee: opts.fee ?? 0n,
      scope: opts.scope ?? this.ctx.config.pool.scope,
      stateLeaves,
      depositIndices,
      artifacts: this.ctx.artifacts,
      snarkjs: opts.snarkjs,
    });
  }

  /**
   * Dry-run a full withdrawal for a note: generates the proof and simulates the
   * withdrawal transaction, but never signs or submits it. Lets an integrator
   * validate a withdrawal end-to-end — including the real payout and resource
   * cost — without spending the note's nullifier.
   */
  async dryRunWithdraw(opts: {
    note: PoolNote;
    recipient: string;
    relayer?: string;
    fee?: bigint;
    scope?: number;
    stateLeaves?: bigint[];
    depositIndices?: number[];
    /** Account to simulate the transaction from (defaults to the connected signer). */
    source?: string;
    /** Testing only: inject a stub in place of `snarkjs`. */
    snarkjs?: Parameters<typeof provePoolWithdraw>[0]["snarkjs"];
  }): Promise<DryRunWithdrawResult> {
    const fee = opts.fee ?? 0n;
    const relayer = opts.relayer ?? opts.recipient;
    const source = await this.source(opts.source);

    const proof = await this.proveWithdraw({
      note: opts.note,
      recipient: opts.recipient,
      relayer,
      fee,
      scope: opts.scope,
      stateLeaves: opts.stateLeaves,
      depositIndices: opts.depositIndices,
      snarkjs: opts.snarkjs,
    });

    const simulation = await this.ctx.contracts.privacyPool.simulateWithdraw({
      ...proof,
      recipient: opts.recipient,
      fee,
      relayer,
      source,
    });

    return {
      proof,
      recipient: opts.recipient,
      relayer,
      fee,
      expectedPayout: proof.withdrawnValue - fee,
      simulation,
    };
  }
}

export interface DryRunWithdrawResult {
  proof: PoolWithdrawProof;
  recipient: string;
  relayer: string;
  fee: bigint;
  /** `proof.withdrawnValue - fee`: what `recipient` would actually receive. */
  expectedPayout: bigint;
  /** Simulated fee + resource usage; nothing here was submitted on-chain. */
  simulation: SimulationReport;
}
