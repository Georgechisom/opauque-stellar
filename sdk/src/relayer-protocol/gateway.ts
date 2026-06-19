/**
 * Relayer-market gateway client: build a blind withdrawal payload, advertise a
 * job, collect and verify bids (signature + on-chain registry state), pick a
 * relayer, and deliver the payload encrypted to its X25519 key. HTTP transport
 * is the `opaque/jobs/v1` gateway API.
 */
import type { ContractInvoker } from "../rpc/client";
import { addressToScVal, bytesToScVal } from "../rpc/scval";
import type { PoolWithdrawProof } from "../prove/pool";
import { sealBox } from "./box";
import {
  makeAdvert,
  validateBid,
  verifyBid,
  type JobAdvert,
  type RelayerBid,
} from "./messages";
import { assertLength, bytesToHex, hexToBytes } from "./bytes";
import {
  encodePoolWithdrawPayload,
  hashPoolWithdrawPayload,
  RELAY_CHAIN_STELLAR,
  type PoolWithdrawPayload,
} from "./payload";

export type VerifiedBid = RelayerBid & { freeStakeValue: bigint };

export type RelayerJobDraft = {
  jobId: Uint8Array;
  jobIdHex: string;
  payload: PoolWithdrawPayload;
  payloadHash: Uint8Array;
  payloadHashHex: string;
  advert: JobAdvert;
  deadlineLedger: number;
  fee: bigint;
};

export type RelayerJobStatus =
  | "open"
  | "accepted"
  | "submitted"
  | "slashed"
  | "canceled"
  | "unknown";

const REGISTRY_JOB_STATUS: Record<number, RelayerJobStatus> = {
  0: "open",
  1: "accepted",
  2: "submitted",
  3: "slashed",
  4: "canceled",
};

type NativeRegistryJob = { status: number | bigint; fee: bigint | number | string };
type NativeRegistryRelayer = {
  endpoint?: string;
  free_stake: bigint | number | string;
  x25519_pubkey: Uint8Array | number[];
};

/** Cryptographically random 32-byte job id. */
export function randomJobId(): Uint8Array {
  const out = new Uint8Array(32);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Build the blind withdrawal payload. The pool fee is zero (the registry escrow
 * pays the relayer) and the proof binds the registry as the pool relayer, so the
 * payload hash is deterministic before a relayer is chosen.
 */
export function buildRelayedWithdrawPayload(args: {
  poolId: string;
  registryId: string;
  proof: PoolWithdrawProof;
  recipient: string;
}): PoolWithdrawPayload {
  return {
    poolId: args.poolId,
    proofA: args.proof.proofA,
    proofB: args.proof.proofB,
    proofC: args.proof.proofC,
    withdrawnValue: args.proof.withdrawnValue,
    stateRoot: args.proof.stateRoot,
    aspRoot: args.proof.aspRoot,
    nullifierHash: args.proof.nullifierHash,
    newCommitment: args.proof.newCommitment,
    recipient: args.recipient,
    poolFee: 0n,
    poolRelayer: args.registryId,
  };
}

export function buildRelayerJobDraft(args: {
  payload: PoolWithdrawPayload;
  fee: bigint;
  deadlineLedger: number;
  jobId?: Uint8Array;
}): RelayerJobDraft {
  const jobId = assertLength(args.jobId ?? randomJobId(), 32, "jobId");
  const payloadHash = hashPoolWithdrawPayload(args.payload);
  return {
    jobId,
    jobIdHex: bytesToHex(jobId),
    payload: args.payload,
    payloadHash,
    payloadHashHex: bytesToHex(payloadHash),
    advert: makeAdvert({ jobId, fee: args.fee, deadline: args.deadlineLedger, payloadHash }),
    deadlineLedger: args.deadlineLedger,
    fee: args.fee,
  };
}

/** Stake-weighted random choice among verified bids. */
export function pickStakeWeightedBid(bids: VerifiedBid[]): VerifiedBid | null {
  if (bids.length === 0) return null;
  const total = bids.reduce((sum, bid) => sum + bid.freeStakeValue, 0n);
  if (total <= 0n) return bids[0];
  const rand = new Uint32Array(2);
  globalThis.crypto.getRandomValues(rand);
  let target = ((BigInt(rand[0]) << 32n) + BigInt(rand[1])) % total;
  for (const bid of bids) {
    if (target < bid.freeStakeValue) return bid;
    target -= bid.freeStakeValue;
  }
  return bids[bids.length - 1];
}

export class RelayerGateway {
  private readonly gatewayUrls: string[];
  private readonly registryId: string;
  private readonly invoker: ContractInvoker;

  constructor(opts: { gatewayUrls: string[]; registryId: string; invoker: ContractInvoker }) {
    if (opts.gatewayUrls.length === 0) {
      throw new Error("RelayerGateway requires at least one gateway URL.");
    }
    this.gatewayUrls = opts.gatewayUrls;
    this.registryId = opts.registryId;
    this.invoker = opts.invoker;
  }

  private url(path: string, base = this.gatewayUrls[0]): string {
    return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
  }

  /** A deadline `ledgers` ahead of the current ledger. */
  async deadlineLedger(ledgers = 720): Promise<number> {
    return (await this.invoker.getLatestLedger()) + ledgers;
  }

  async publishAdvert(advert: JobAdvert, gateway = this.gatewayUrls[0]): Promise<void> {
    const res = await fetch(this.url("v1/jobs", gateway), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(advert),
    });
    if (!res.ok) throw new Error(`Relayer gateway rejected advert (${res.status}).`);
  }

  async fetchBids(jobIdHex: string, gateway = this.gatewayUrls[0]): Promise<VerifiedBid[]> {
    const res = await fetch(this.url(`v1/jobs/${encodeURIComponent(jobIdHex)}/bids`, gateway));
    if (!res.ok) throw new Error(`Could not fetch relayer bids (${res.status}).`);
    const body = (await res.json()) as { bids?: unknown[] };
    const signed = (body.bids ?? [])
      .map((raw) => validateBid(raw))
      .filter((bid) => verifyBid(bid))
      .filter((bid) => bid.jobId.toLowerCase() === jobIdHex.toLowerCase())
      .filter((bid) => bid.chain === RELAY_CHAIN_STELLAR);
    const checked = await Promise.all(signed.map((bid) => this.verifyBidRegistryState(jobIdHex, bid)));
    return checked.filter((bid): bid is VerifiedBid => bid !== null);
  }

  async deliverPayload(args: {
    draft: RelayerJobDraft;
    bid: RelayerBid;
    gateway?: string;
  }): Promise<{ acceptedTx?: string; submittedTx?: string } | null> {
    const box = await sealBox(
      encodePoolWithdrawPayload(args.draft.payload),
      hexToBytes(args.bid.x25519Pk),
    );
    const res = await fetch(
      this.url(`v1/jobs/${encodeURIComponent(args.draft.jobIdHex)}/payload`, args.gateway ?? this.gatewayUrls[0]),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: "payload", v: 1, jobId: args.draft.jobIdHex, to: args.bid.x25519Pk, box }),
      },
    );
    if (!res.ok) throw new Error(`Relayer gateway rejected payload (${res.status}).`);
    const body = (await res.json()) as {
      result?: { acceptedTx?: string; submittedTx?: string } | null;
    };
    return body.result ?? null;
  }

  async jobStatus(jobIdHex: string, source: string): Promise<RelayerJobStatus> {
    const job = await this.registryView<NativeRegistryJob>(source, "get_job", [
      bytesToScVal(hexToBytes(jobIdHex)),
    ]);
    if (!job) return "unknown";
    return REGISTRY_JOB_STATUS[Number(job.status)] ?? "unknown";
  }

  private async verifyBidRegistryState(
    jobIdHex: string,
    bid: RelayerBid,
  ): Promise<VerifiedBid | null> {
    try {
      const [job, relayer] = await Promise.all([
        this.registryView<NativeRegistryJob>(bid.operator, "get_job", [
          bytesToScVal(hexToBytes(jobIdHex)),
        ]),
        this.registryView<NativeRegistryRelayer>(bid.operator, "get_relayer", [
          addressToScVal(bid.operator),
        ]),
      ]);
      if (!job || !relayer) return null;
      const fee = BigInt(job.fee);
      const freeStakeValue = BigInt(relayer.free_stake);
      if (Number(job.status) !== 0 || freeStakeValue < fee) return null;
      const registeredPk = bytesToHex(Uint8Array.from(relayer.x25519_pubkey));
      if (registeredPk.toLowerCase() !== bid.x25519Pk.toLowerCase()) return null;
      return {
        ...bid,
        endpoint: relayer.endpoint?.trim() || bid.endpoint,
        freeStake: freeStakeValue.toString(),
        freeStakeValue,
      };
    } catch {
      return null;
    }
  }

  private async registryView<T>(
    source: string,
    method: string,
    args: Parameters<ContractInvoker["readNative"]>[0]["args"],
  ): Promise<T | null> {
    try {
      return await this.invoker.readNative<T>({
        source,
        contractId: this.registryId,
        method,
        args,
      });
    } catch {
      return null;
    }
  }
}
