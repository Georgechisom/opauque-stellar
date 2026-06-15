import {
  makeAdvert,
  validateBid,
  verifyBid,
  type JobAdvert,
  type RelayerBid,
} from "@relayer/messages";
import { sealBox } from "@relayer/shared/box";
import {
  assertLength,
  bytesToHex,
  hexToBytes,
} from "@relayer/shared/bytes";
import {
  encodePoolWithdrawPayload,
  hashPoolWithdrawPayload,
  type PoolWithdrawPayload,
} from "@relayer/shared/payload";
import { getSorobanServer } from "./stellar";
import type { WithdrawProof } from "./poolProver";

const DEFAULT_GATEWAY = "http://127.0.0.1:8787";
const DEFAULT_JOB_DEADLINE_LEDGERS = 720;

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

export type VerifiedBid = RelayerBid & {
  freeStakeValue: bigint;
};

export function relayerGatewayUrl(): string {
  return (
    (import.meta.env.VITE_RELAYER_GATEWAY_URL as string | undefined)?.trim() ||
    DEFAULT_GATEWAY
  );
}

export function randomJobId(): Uint8Array {
  const out = new Uint8Array(32);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function defaultDeadlineLedger(
  ledgers = DEFAULT_JOB_DEADLINE_LEDGERS,
): Promise<number> {
  const latest = await getSorobanServer().getLatestLedger();
  return latest.sequence + ledgers;
}

export function buildRelayedWithdrawPayload(args: {
  poolId: string;
  registryId: string;
  proof: WithdrawProof;
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
    // The pool fee is zero in Phase 6 MVP; registry escrow pays the selected relayer.
    // Binding the registry address keeps the proof payload deterministic before bidding.
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
  const advert = makeAdvert({
    jobId,
    fee: args.fee,
    deadline: args.deadlineLedger,
    payloadHash,
  });
  return {
    jobId,
    jobIdHex: bytesToHex(jobId),
    payload: args.payload,
    payloadHash,
    payloadHashHex: bytesToHex(payloadHash),
    advert,
    deadlineLedger: args.deadlineLedger,
    fee: args.fee,
  };
}

function gatewayUrl(path: string, base = relayerGatewayUrl()): string {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  return url.toString();
}

export async function publishAdvert(advert: JobAdvert, gateway = relayerGatewayUrl()): Promise<void> {
  const res = await fetch(gatewayUrl("v1/jobs", gateway), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(advert),
  });
  if (!res.ok) throw new Error(`Relayer gateway rejected advert (${res.status}).`);
}

export async function fetchRelayerBids(
  jobIdHex: string,
  gateway = relayerGatewayUrl(),
): Promise<VerifiedBid[]> {
  const res = await fetch(
    gatewayUrl(`v1/jobs/${encodeURIComponent(jobIdHex)}/bids`, gateway),
  );
  if (!res.ok) throw new Error(`Could not fetch relayer bids (${res.status}).`);
  const body = (await res.json()) as { bids?: unknown[] };
  return (body.bids ?? [])
    .map((raw) => validateBid(raw))
    .filter((bid) => verifyBid(bid))
    .map((bid) => ({ ...bid, freeStakeValue: BigInt(bid.freeStake ?? "0") }));
}

export async function deliverPayloadToRelayer(args: {
  draft: RelayerJobDraft;
  bid: RelayerBid;
  gateway?: string;
}): Promise<{ acceptedTx?: string; submittedTx?: string } | null> {
  const box = sealBox(
    encodePoolWithdrawPayload(args.draft.payload),
    hexToBytes(args.bid.x25519Pk),
  );
  const res = await fetch(
    gatewayUrl(
      `v1/jobs/${encodeURIComponent(args.draft.jobIdHex)}/payload`,
      args.gateway ?? relayerGatewayUrl(),
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        t: "payload",
        v: 1,
        jobId: args.draft.jobIdHex,
        to: args.bid.x25519Pk,
        box,
      }),
    },
  );
  if (!res.ok) throw new Error(`Relayer gateway rejected payload (${res.status}).`);
  const body = (await res.json()) as {
    result?: { acceptedTx?: string; submittedTx?: string } | null;
  };
  return body.result ?? null;
}

export function pickStakeWeightedBid(bids: VerifiedBid[]): VerifiedBid | null {
  if (bids.length === 0) return null;
  const total = bids.reduce((sum, bid) => sum + bid.freeStakeValue, 0n);
  if (total <= 0n) return bids[0];
  const rand = new Uint32Array(2);
  globalThis.crypto.getRandomValues(rand);
  const r = (BigInt(rand[0]) << 32n) + BigInt(rand[1]);
  let target = r % total;
  for (const bid of bids) {
    if (target < bid.freeStakeValue) return bid;
    target -= bid.freeStakeValue;
  }
  return bids[bids.length - 1];
}
