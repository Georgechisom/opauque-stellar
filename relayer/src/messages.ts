import { Keypair } from "@stellar/stellar-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { Buffer } from "buffer";
import { assertLength, base64ToBytes, bytesToBase64, bytesToHex, concatBytes, hexToBytes } from "./shared/bytes.ts";
import { RELAY_CHAIN_STELLAR } from "./shared/payload.ts";

const BID_DOMAIN = new TextEncoder().encode("opaque-relayer-bid-v1");

export type JobAdvert = {
  t: "advert";
  v: 1;
  jobId: string;
  chain: number;
  fee: string;
  deadline: number;
  payloadHash: string;
};

export type RelayerBid = {
  t: "bid";
  v: 1;
  jobId: string;
  chain: number;
  operator: string;
  x25519Pk: string;
  sig: string;
  endpoint?: string;
  freeStake?: string;
};

export type EncryptedPayload = {
  t: "payload";
  v: 1;
  jobId: string;
  to: string;
  box: string;
  idempotencyKey?: string;
};

export type RelayerMessage = JobAdvert | RelayerBid | EncryptedPayload;

export function validateRelayerMessage(value: unknown): RelayerMessage {
  const v = value as { t?: unknown };
  if (v?.t === "advert") return validateAdvert(value);
  if (v?.t === "bid") return validateBid(value);
  if (v?.t === "payload") return validatePayload(value);
  throw new Error("Invalid relayer message.");
}

export function makeAdvert(args: {
  jobId: Uint8Array;
  fee: bigint;
  deadline: number;
  payloadHash: Uint8Array;
  chain?: number;
}): JobAdvert {
  return {
    t: "advert",
    v: 1,
    jobId: bytesToHex(assertLength(args.jobId, 32, "jobId")),
    chain: args.chain ?? RELAY_CHAIN_STELLAR,
    fee: args.fee.toString(),
    deadline: args.deadline,
    payloadHash: bytesToHex(assertLength(args.payloadHash, 32, "payloadHash")),
  };
}

export function bidSigningDigest(jobId: Uint8Array, x25519Pk: Uint8Array): Uint8Array {
  return keccak_256(
    concatBytes(
      BID_DOMAIN,
      assertLength(jobId, 32, "jobId"),
      assertLength(x25519Pk, 32, "x25519Pk"),
    ),
  );
}

export function makeBid(args: {
  advert: JobAdvert;
  operator: Keypair;
  x25519Pk: Uint8Array;
  endpoint?: string;
  freeStake?: bigint;
}): RelayerBid {
  const x25519Pk = assertLength(args.x25519Pk, 32, "x25519Pk");
  const digest = bidSigningDigest(hexToBytes(args.advert.jobId), x25519Pk);
  return {
    t: "bid",
    v: 1,
    jobId: args.advert.jobId,
    chain: args.advert.chain,
    operator: args.operator.publicKey(),
    x25519Pk: bytesToHex(x25519Pk),
    sig: bytesToBase64(args.operator.sign(Buffer.from(digest))),
    endpoint: args.endpoint,
    freeStake: args.freeStake?.toString(),
  };
}

export function verifyBid(bid: RelayerBid): boolean {
  try {
    const digest = bidSigningDigest(hexToBytes(bid.jobId), hexToBytes(bid.x25519Pk));
    return Keypair.fromPublicKey(bid.operator).verify(
      Buffer.from(digest),
      Buffer.from(base64ToBytes(bid.sig)),
    );
  } catch {
    return false;
  }
}

export function validateAdvert(value: unknown): JobAdvert {
  const v = value as Partial<JobAdvert>;
  if (
    v?.t !== "advert" ||
    v.v !== 1 ||
    typeof v.jobId !== "string" ||
    typeof v.payloadHash !== "string" ||
    typeof v.fee !== "string" ||
    typeof v.deadline !== "number"
  ) {
    throw new Error("Invalid relayer advert.");
  }
  assertLength(hexToBytes(v.jobId), 32, "jobId");
  assertLength(hexToBytes(v.payloadHash), 32, "payloadHash");
  return { ...v, chain: v.chain ?? RELAY_CHAIN_STELLAR } as JobAdvert;
}

export function validateBid(value: unknown): RelayerBid {
  const v = value as Partial<RelayerBid>;
  if (
    v?.t !== "bid" ||
    v.v !== 1 ||
    typeof v.jobId !== "string" ||
    typeof v.operator !== "string" ||
    typeof v.x25519Pk !== "string" ||
    typeof v.sig !== "string"
  ) {
    throw new Error("Invalid relayer bid.");
  }
  assertLength(hexToBytes(v.jobId), 32, "jobId");
  assertLength(hexToBytes(v.x25519Pk), 32, "x25519Pk");
  return { ...v, chain: v.chain ?? RELAY_CHAIN_STELLAR } as RelayerBid;
}

export function validatePayload(value: unknown): EncryptedPayload {
  const v = value as Partial<EncryptedPayload>;
  if (
    v?.t !== "payload" ||
    v.v !== 1 ||
    typeof v.jobId !== "string" ||
    typeof v.to !== "string" ||
    typeof v.box !== "string"
  ) {
    throw new Error("Invalid relayer payload.");
  }
  assertLength(hexToBytes(v.jobId), 32, "jobId");
  assertLength(hexToBytes(v.to), 32, "payload recipient");
  return v as EncryptedPayload;
}
