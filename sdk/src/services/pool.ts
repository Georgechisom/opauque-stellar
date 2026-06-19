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
  }): Promise<{ note: PoolNote; txHash: string }> {
    const signer = this.ctx.requireSigner();
    const source = await signer.publicKey();
    const scope = this.ctx.config.pool.scope;
    const value = parseXlmToStroops(opts.amountXlm);

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
   * (`new OpaqueClient({ artifacts })`) and the reconstructed pool leaves
   * (`stateLeaves` + `depositIndices`) read from on-chain Deposit/Withdraw events.
   */
  async proveWithdraw(opts: {
    note: PoolNote;
    recipient: string;
    relayer?: string;
    fee?: bigint;
    scope?: number;
    stateLeaves: bigint[];
    depositIndices: number[];
  }): Promise<PoolWithdrawProof> {
    if (!this.ctx.artifacts) {
      throw new NotWiredError(
        "Pool withdrawal proof generation",
        "Construct OpaqueClient with { artifacts } to enable proving, or pass a precomputed bundle to withdraw().",
      );
    }
    return provePoolWithdraw({
      note: opts.note,
      recipient: opts.recipient,
      relayer: opts.relayer ?? opts.recipient,
      fee: opts.fee ?? 0n,
      scope: opts.scope ?? this.ctx.config.pool.scope,
      stateLeaves: opts.stateLeaves,
      depositIndices: opts.depositIndices,
      artifacts: this.ctx.artifacts,
    });
  }
}
