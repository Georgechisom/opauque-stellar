import { Keypair } from "@stellar/stellar-sdk";
import { openBox } from "./shared/box.ts";
import {
  decodePoolWithdrawPayload,
  hashPoolWithdrawPayloadHex,
  type PoolWithdrawPayload,
} from "./shared/payload.ts";
import { bytesToHex } from "./shared/bytes.ts";
import {
  makeBid,
  validateAdvert,
  validatePayload,
  type EncryptedPayload,
  type JobAdvert,
  type RelayerBid,
} from "./messages.ts";

export type OnChainJob = {
  exists: boolean;
  status: "open" | "accepted" | "submitted" | "slashed" | "canceled";
  fee: bigint;
  deadline: number;
  payloadHash: string;
};

export type OnChainRelayer = {
  registered: boolean;
  x25519Pk: string;
  endpoint: string;
  freeStake: bigint;
};

export interface RelayerChainAdapter {
  getJob(jobId: string): Promise<OnChainJob | null>;
  getRelayer(operator: string): Promise<OnChainRelayer | null>;
  simulatePoolWithdraw(payload: PoolWithdrawPayload): Promise<void>;
  acceptJob(jobId: string): Promise<string>;
  submitPoolWithdraw(jobId: string, payload: PoolWithdrawPayload): Promise<string>;
}

export interface RelayerEngineConfig {
  operator: Keypair;
  x25519PublicKey: Uint8Array;
  x25519SecretKey: Uint8Array;
  endpoint?: string;
  minFee: bigint;
  chain: RelayerChainAdapter;
}

export type RelayerEngineStats = {
  jobsSeen: number;
  bidsSent: number;
  payloadsSeen: number;
  accepted: number;
  submitted: number;
  rejected: number;
  lastError: string | null;
};

export class RelayerEngine {
  readonly stats: RelayerEngineStats = {
    jobsSeen: 0,
    bidsSent: 0,
    payloadsSeen: 0,
    accepted: 0,
    submitted: 0,
    rejected: 0,
    lastError: null,
  };

  private bids = new Map<string, RelayerBid[]>();

  constructor(private cfg: RelayerEngineConfig) {}

  bidsFor(jobId: string): RelayerBid[] {
    return this.bids.get(jobId.toLowerCase()) ?? [];
  }

  async handleAdvert(raw: unknown): Promise<RelayerBid | null> {
    const advert = validateAdvert(raw);
    this.stats.jobsSeen += 1;
    try {
      const relayer = await this.cfg.chain.getRelayer(this.cfg.operator.publicKey());
      if (!relayer?.registered) return null;
      const job = await this.cfg.chain.getJob(advert.jobId);
      if (!job?.exists || job.status !== "open") return null;
      if (job.fee < this.cfg.minFee || relayer.freeStake < job.fee) return null;
      if (
        job.fee.toString() !== advert.fee ||
        job.deadline !== advert.deadline ||
        job.payloadHash.toLowerCase() !== advert.payloadHash.toLowerCase()
      ) {
        return null;
      }
      const bid = makeBid({
        advert,
        operator: this.cfg.operator,
        x25519Pk: this.cfg.x25519PublicKey,
        endpoint: this.cfg.endpoint,
        freeStake: relayer.freeStake,
      });
      this.rememberBid(bid);
      this.stats.bidsSent += 1;
      return bid;
    } catch (err) {
      this.stats.rejected += 1;
      this.stats.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  rememberBid(bid: RelayerBid): void {
    const key = bid.jobId.toLowerCase();
    const list = this.bids.get(key) ?? [];
    if (!list.some((b) => b.operator === bid.operator)) {
      list.push(bid);
      this.bids.set(key, list);
    }
  }

  async handlePayload(raw: unknown): Promise<{ acceptedTx: string; submittedTx: string } | null> {
    const payloadMsg: EncryptedPayload = validatePayload(raw);
    this.stats.payloadsSeen += 1;
    const ownPk = bytesToHex(this.cfg.x25519PublicKey).toLowerCase();
    if (payloadMsg.to.toLowerCase() !== ownPk) return null;
    try {
      const plaintext = openBox(payloadMsg.box, this.cfg.x25519SecretKey);
      const payload = decodePoolWithdrawPayload(plaintext);
      const job = await this.cfg.chain.getJob(payloadMsg.jobId);
      if (!job?.exists || job.status !== "open") return null;
      if (hashPoolWithdrawPayloadHex(payload).toLowerCase() !== job.payloadHash.toLowerCase()) {
        throw new Error("Payload hash mismatch.");
      }
      await this.cfg.chain.simulatePoolWithdraw(payload);
      const acceptedTx = await this.cfg.chain.acceptJob(payloadMsg.jobId);
      this.stats.accepted += 1;
      const submittedTx = await this.cfg.chain.submitPoolWithdraw(payloadMsg.jobId, payload);
      this.stats.submitted += 1;
      return { acceptedTx, submittedTx };
    } catch (err) {
      this.stats.rejected += 1;
      this.stats.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}
