import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createRelayerHttpServer } from "../src/http.ts";
import { RelayerEngine, type RelayerChainAdapter, type OnChainJob, type OnChainRelayer } from "../src/engine.ts";
import { generateX25519Keypair, openBox, sealBox } from "../src/shared/box.ts";
import { bytesToHex, hexToBytes } from "../src/shared/bytes.ts";
import {
  encodePoolWithdrawPayload,
  hashPoolWithdrawPayloadHex,
  type PoolWithdrawPayload,
} from "../src/shared/payload.ts";
import { makeAdvert, verifyBid } from "../src/messages.ts";

const ACCOUNT_A = "GABTYFQAXDR724JAJSNZVUH56T62JJ7CLWT6YL56ME7OPA4DIIMAMOI6";
const ACCOUNT_B = "GDKPRDH3AGALVIZ3OX5LJGNIXZOWUBCIX5HA36YXOSQOGEZLDCJOSGDR";
const CONTRACT = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

function bytes(len: number, tag: number): Uint8Array {
  return new Uint8Array(len).fill(tag);
}

function payload(poolRelayer = ACCOUNT_B): PoolWithdrawPayload {
  return {
    poolId: CONTRACT,
    proofA: bytes(64, 0xa1),
    proofB: bytes(128, 0xb2),
    proofC: bytes(64, 0xc3),
    withdrawnValue: 500n,
    stateRoot: bytes(32, 0x51),
    aspRoot: bytes(32, 0xa5),
    nullifierHash: bytes(32, 0x9a),
    newCommitment: bytes(32, 0xce),
    recipient: ACCOUNT_A,
    poolFee: 0n,
    poolRelayer,
  };
}

class FakeChain implements RelayerChainAdapter {
  job: OnChainJob;
  relayer: OnChainRelayer;
  accepted = 0;
  submitted = 0;
  simulated = 0;

  constructor(payloadHash: string, x25519Pk: string) {
    this.job = {
      exists: true,
      status: "open",
      fee: 100n,
      deadline: 150,
      payloadHash,
    };
    this.relayer = {
      registered: true,
      x25519Pk,
      endpoint: "http://127.0.0.1:8787",
      freeStake: 1_000n,
    };
  }

  async getJob(): Promise<OnChainJob> {
    return this.job;
  }

  async getRelayer(): Promise<OnChainRelayer> {
    return this.relayer;
  }

  async simulatePoolWithdraw(): Promise<void> {
    this.simulated += 1;
  }

  async acceptJob(): Promise<string> {
    this.accepted += 1;
    return "accept-tx";
  }

  async submitPoolWithdraw(): Promise<string> {
    this.submitted += 1;
    this.job.status = "submitted";
    return "submit-tx";
  }
}

describe("relayer market shared crypto", () => {
  it("encrypts payloads only the selected relayer can open", () => {
    const recipient = generateX25519Keypair();
    const other = generateX25519Keypair();
    const plaintext = new TextEncoder().encode("blind job");
    const box = sealBox(plaintext, recipient.publicKey);
    expect(new TextDecoder().decode(openBox(box, recipient.secretKey))).toBe("blind job");
    expect(() => openBox(box, other.secretKey)).toThrow(/decrypt/i);
  });
});

describe("relayer market messages", () => {
  it("signs and verifies bids", () => {
    const operator = Keypair.random();
    const x25519 = generateX25519Keypair();
    const p = payload(operator.publicKey());
    const advert = makeAdvert({
      jobId: bytes(32, 0x11),
      fee: 100n,
      deadline: 150,
      payloadHash: hexToBytes(hashPoolWithdrawPayloadHex(p)),
    });
    const chain = new FakeChain(advert.payloadHash, bytesToHex(x25519.publicKey));
    const engine = new RelayerEngine({
      operator,
      x25519PublicKey: x25519.publicKey,
      x25519SecretKey: x25519.secretKey,
      minFee: 1n,
      chain,
    });
    return engine.handleAdvert(advert).then((bid) => {
      expect(bid).not.toBeNull();
      expect(verifyBid(bid!)).toBe(true);
    });
  });
});

describe("relayer engine", () => {
  it("accepts and submits only after decrypting a hash-matching payload", async () => {
    const operator = Keypair.random();
    const x25519 = generateX25519Keypair();
    const p = payload(operator.publicKey());
    const hash = hashPoolWithdrawPayloadHex(p);
    const chain = new FakeChain(hash, bytesToHex(x25519.publicKey));
    const engine = new RelayerEngine({
      operator,
      x25519PublicKey: x25519.publicKey,
      x25519SecretKey: x25519.secretKey,
      minFee: 1n,
      chain,
    });
    const jobId = bytesToHex(bytes(32, 0x12));
    const box = sealBox(encodePoolWithdrawPayload(p), x25519.publicKey);
    const result = await engine.handlePayload({ t: "payload", v: 1, jobId, to: bytesToHex(x25519.publicKey), box });
    expect(result).toEqual({ acceptedTx: "accept-tx", submittedTx: "submit-tx" });
    expect(chain.simulated).toBe(1);
    expect(chain.accepted).toBe(1);
    expect(chain.submitted).toBe(1);
  });

  it("rejects encrypted payloads whose hash does not match the job", async () => {
    const operator = Keypair.random();
    const x25519 = generateX25519Keypair();
    const chain = new FakeChain(bytesToHex(bytes(32, 0xff)), bytesToHex(x25519.publicKey));
    const engine = new RelayerEngine({
      operator,
      x25519PublicKey: x25519.publicKey,
      x25519SecretKey: x25519.secretKey,
      minFee: 1n,
      chain,
    });
    const p = payload(operator.publicKey());
    const box = sealBox(encodePoolWithdrawPayload(p), x25519.publicKey);
    await expect(
      engine.handlePayload({ t: "payload", v: 1, jobId: bytesToHex(bytes(32, 0x13)), to: bytesToHex(x25519.publicKey), box }),
    ).rejects.toThrow(/hash mismatch/i);
    expect(chain.accepted).toBe(0);
  });
});

describe("relayer HTTP gateway", () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it("serves bids over the spec gateway endpoints", async () => {
    const operator = Keypair.random();
    const x25519 = generateX25519Keypair();
    const p = payload(operator.publicKey());
    const advert = makeAdvert({
      jobId: bytes(32, 0x14),
      fee: 100n,
      deadline: 150,
      payloadHash: hexToBytes(hashPoolWithdrawPayloadHex(p)),
    });
    const chain = new FakeChain(advert.payloadHash, bytesToHex(x25519.publicKey));
    const engine = new RelayerEngine({
      operator,
      x25519PublicKey: x25519.publicKey,
      x25519SecretKey: x25519.secretKey,
      minFee: 1n,
      chain,
    });
    const server = createRelayerHttpServer(engine);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup = () => new Promise<void>((resolve) => server.close(() => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server port.");
    const base = `http://127.0.0.1:${address.port}`;

    const post = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(advert),
    });
    expect(post.status).toBe(202);
    const listed = await fetch(`${base}/v1/jobs/${encodeURIComponent(advert.jobId)}/bids`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { bids: unknown[] };
    expect(body.bids).toHaveLength(1);
  });
});
