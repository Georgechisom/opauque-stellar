/**
 * End-to-end relayer protocol: payload hashing (the value the registry contract
 * recomputes), NaCl box sealing to a relayer's key, bid signing/verification,
 * and blind job-draft construction.
 */
import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  hashPoolWithdrawPayload,
  encodePoolWithdrawPayload,
  decodePoolWithdrawPayload,
  generateX25519Keypair,
  sealBox,
  openBox,
  makeAdvert,
  makeBid,
  verifyBid,
  buildRelayedWithdrawPayload,
  buildRelayerJobDraft,
  pickStakeWeightedBid,
  TESTNET_DEPLOYMENT,
  type PoolWithdrawPayload,
  type VerifiedBid,
} from "../../src/index";

const POOL = TESTNET_DEPLOYMENT.contracts.privacyPool;
const REGISTRY = TESTNET_DEPLOYMENT.contracts.relayerRegistry;
const RECIPIENT = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";
const b = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

const PROOF = {
  proofA: b(64),
  proofB: b(128),
  proofC: b(64),
  withdrawnValue: 5_000_000n,
  stateRoot: b(32, 2),
  aspRoot: b(32, 3),
  nullifierHash: b(32, 4),
  newCommitment: b(32, 5),
};

function payload(): PoolWithdrawPayload {
  return buildRelayedWithdrawPayload({
    poolId: POOL,
    registryId: REGISTRY,
    proof: PROOF,
    recipient: RECIPIENT,
  });
}

describe("relayer payload (end to end)", () => {
  it("hashes deterministically to 32 bytes and round-trips", () => {
    const p = payload();
    const h1 = hashPoolWithdrawPayload(p);
    const h2 = hashPoolWithdrawPayload(p);
    expect(h1.length).toBe(32);
    expect(Array.from(h1)).toEqual(Array.from(h2));

    const decoded = decodePoolWithdrawPayload(encodePoolWithdrawPayload(p));
    expect(decoded.recipient).toBe(RECIPIENT);
    expect(decoded.withdrawnValue).toBe(5_000_000n);
    expect(decoded.poolFee).toBe(0n);
  });

  it("rejects a wrong-length proof component", () => {
    const bad = { ...payload(), proofA: b(63) };
    expect(() => hashPoolWithdrawPayload(bad)).toThrow();
  });
});

describe("relayer box encryption (end to end)", () => {
  it("seals to a relayer key and opens with its secret", async () => {
    const relayer = await generateX25519Keypair();
    const message = encodePoolWithdrawPayload(payload());
    const box = await sealBox(message, relayer.publicKey);
    const opened = await openBox(box, relayer.secretKey);
    expect(Array.from(opened)).toEqual(Array.from(message));
  });

  it("fails to open with the wrong secret", async () => {
    const relayer = await generateX25519Keypair();
    const stranger = await generateX25519Keypair();
    const box = await sealBox(new Uint8Array([1, 2, 3]), relayer.publicKey);
    await expect(openBox(box, stranger.secretKey)).rejects.toThrow();
  });
});

describe("relayer bids (end to end)", () => {
  it("signs and verifies a bid", async () => {
    const draft = buildRelayerJobDraft({ payload: payload(), fee: 1_000_000n, deadlineLedger: 100 });
    const operator = Keypair.random();
    const x = await generateX25519Keypair();
    const bid = makeBid({ advert: draft.advert, operator, x25519Pk: x.publicKey });
    expect(verifyBid(bid)).toBe(true);

    const tampered = { ...bid, operator: Keypair.random().publicKey() };
    expect(verifyBid(tampered)).toBe(false);
  });

  it("advert carries the job's payload hash", () => {
    const draft = buildRelayerJobDraft({ payload: payload(), fee: 1n, deadlineLedger: 100 });
    expect(draft.advert.payloadHash).toBe(draft.payloadHashHex);
    expect(makeAdvert({ jobId: draft.jobId, fee: 1n, deadline: 100, payloadHash: draft.payloadHash }).jobId).toBe(
      draft.jobIdHex,
    );
  });

  it("picks a stake-weighted bid", () => {
    const bids: VerifiedBid[] = [
      { t: "bid", v: 1, jobId: "0x00", chain: 3000, operator: "G1", x25519Pk: "0x00", sig: "", freeStakeValue: 10n },
      { t: "bid", v: 1, jobId: "0x00", chain: 3000, operator: "G2", x25519Pk: "0x00", sig: "", freeStakeValue: 90n },
    ];
    const picked = pickStakeWeightedBid(bids);
    expect(picked).not.toBeNull();
    expect(["G1", "G2"]).toContain(picked!.operator);
    expect(pickStakeWeightedBid([])).toBeNull();
  });
});
