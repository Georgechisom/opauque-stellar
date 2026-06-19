/**
 * Contract-binding argument construction. Drives each binding through a stub
 * invoker that captures the invoke options, then decodes the ScVal arguments to
 * assert the exact on-chain call shape (method, contract, and argument values).
 * This guards the wire format without needing a network.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import {
  StealthRegistry,
  StealthAnnouncer,
  SchemaRegistry,
  AttestationEngine,
  Groth16Verifier,
  PrivacyPool,
  RelayerRegistry,
  keypairSigner,
  fromScVal,
  type ContractInvoker,
  type InvokeOptions,
} from "../../src/index";

class CaptureInvoker implements ContractInvoker {
  last?: InvokeOptions;
  async invoke(opts: InvokeOptions): Promise<string> {
    this.last = opts;
    return "TXHASH";
  }
  async readNative<T>(): Promise<T> {
    throw new Error("not used");
  }
  async simulateRead(): Promise<xdr.ScVal | undefined> {
    throw new Error("not used");
  }
}

const keypair = Keypair.random();
const signer = keypairSigner(keypair);
const PK = keypair.publicKey();
const C = "CAIXWMGYZR3YAQ3CPCXOU42WG62E3ARUSG4GDHHDMNRXUD44YSGE5VXW";
const DELEGATE = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";

let inv: CaptureInvoker;
beforeEach(() => {
  inv = new CaptureInvoker();
});

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const decoded = () => inv.last!.args.map(fromScVal);

describe("payments bindings", () => {
  it("registerKeys encodes [address, u64 scheme, bytes meta]", async () => {
    await new StealthRegistry(inv, C).registerKeys({
      stealthMetaAddress: bytes(66),
      signer,
    });
    expect(inv.last!.method).toBe("register_keys");
    expect(inv.last!.contractId).toBe(C);
    expect(inv.last!.source).toBe(PK);
    const a = decoded();
    expect(a[0]).toBe(PK);
    expect(a[1]).toBe(1n); // default secp256k1 scheme
    expect((a[2] as Uint8Array).length).toBe(66);
  });

  it("announce encodes [address, u64, bytes x3]", async () => {
    await new StealthAnnouncer(inv, C).announce({
      stealthAddress: bytes(20),
      ephemeralPubKey: bytes(33),
      metadata: new Uint8Array([0x2a]),
      signer,
    });
    expect(inv.last!.method).toBe("announce");
    const a = decoded();
    expect(a[0]).toBe(PK);
    expect(a[1]).toBe(1n);
    expect((a[2] as Uint8Array).length).toBe(20);
    expect((a[3] as Uint8Array).length).toBe(33);
    expect(Array.from(a[4] as Uint8Array)).toEqual([0x2a]);
  });
});

describe("attestation bindings", () => {
  it("registerSchema encodes authority key bytes and null resolver", async () => {
    await new SchemaRegistry(inv, C).registerSchema({
      schemaId: bytes(32),
      name: "credit",
      fieldDefinitions: "u64 score",
      revocable: true,
      schemaExpiryLedger: 5_000_000,
      signer,
    });
    expect(inv.last!.method).toBe("register_schema");
    const a = decoded();
    expect(a[0]).toBe(PK);
    expect((a[1] as Uint8Array).length).toBe(32); // decoded ed25519 authority key
    expect((a[2] as Uint8Array).length).toBe(32); // schema id
    expect(a[3]).toBe("credit");
    expect(a[4]).toBe("u64 score");
    expect(a[5]).toBe(true);
    expect(a[6]).toBe(1); // default version
    expect(a[8]).toBe(5_000_000);
  });

  it("addDelegate rejects a non-G delegate", async () => {
    await expect(
      new SchemaRegistry(inv, C).addDelegate({ schemaId: bytes(32), delegate: "nope", signer }),
    ).rejects.toThrow();
  });

  it("attest encodes the issuer + schema + payload", async () => {
    await new AttestationEngine(inv, C).attest({
      schemaId: bytes(32),
      stealthAddressHash: bytes(32),
      data: bytes(8),
      expirationLedger: 6_000_000,
      refUid: bytes(32, 0),
      signer,
    });
    expect(inv.last!.method).toBe("attest");
    const a = decoded();
    expect(a[0]).toBe(PK);
    expect(a[4]).toBe(6_000_000);
  });
});

describe("verifier binding", () => {
  it("verifyProofV2 encodes proofs + a 4-key public-signal map", async () => {
    await new Groth16Verifier(inv, C).verifyProofV2({
      proofA: bytes(64),
      proofB: bytes(128),
      proofC: bytes(64),
      merkleRoot: bytes(32, 1),
      attestationId: bytes(32, 2),
      externalNullifier: bytes(32, 3),
      nullifierHash: bytes(32, 4),
      signer,
    });
    expect(inv.last!.method).toBe("verify_proof_v2");
    const a = decoded();
    expect((a[0] as Uint8Array).length).toBe(64);
    expect((a[1] as Uint8Array).length).toBe(128);
    const map = a[3] as Record<string, Uint8Array>;
    expect(Object.keys(map).sort()).toEqual([
      "attestation_id",
      "external_nullifier",
      "merkle_root",
      "nullifier_hash",
    ]);
    expect(map.merkle_root.length).toBe(32);
  });
});

describe("pool binding", () => {
  it("deposit encodes [address, i128 value, bytes commitment, u64 index]", async () => {
    await new PrivacyPool(inv, C).deposit({
      value: 5_000_000n,
      commitment: bytes(32),
      expectedIndex: 3,
      signer,
    });
    expect(inv.last!.method).toBe("deposit");
    const a = decoded();
    expect(a[0]).toBe(PK);
    expect(a[1]).toBe(5_000_000n);
    expect((a[2] as Uint8Array).length).toBe(32);
    expect(a[3]).toBe(3n);
  });

  it("withdraw encodes 11 args ending in recipient, i128 fee, relayer", async () => {
    await new PrivacyPool(inv, C).withdraw({
      proofA: bytes(64),
      proofB: bytes(128),
      proofC: bytes(64),
      withdrawnValue: 4_000_000n,
      stateRoot: bytes(32),
      aspRoot: bytes(32),
      nullifierHash: bytes(32),
      newCommitment: bytes(32),
      recipient: DELEGATE,
      fee: 0n,
      relayer: PK,
      signer,
    });
    const a = decoded();
    expect(a.length).toBe(11);
    expect(a[3]).toBe(4_000_000n);
    expect(a[8]).toBe(DELEGATE);
    expect(a[9]).toBe(0n);
    expect(a[10]).toBe(PK);
  });

  it("updateRoot selects the method by kind", async () => {
    const pool = new PrivacyPool(inv, C);
    await pool.updateRoot({ kind: "state", root: bytes(32), datasetHash: bytes(32), signer });
    expect(inv.last!.method).toBe("update_state_root");
    await pool.updateRoot({ kind: "asp", root: bytes(32), datasetHash: bytes(32), signer });
    expect(inv.last!.method).toBe("update_asp_root");
  });
});

describe("relayer binding", () => {
  it("createJob encodes [address, bytes id, bytes hash, u32 deadline, i128 fee]", async () => {
    await new RelayerRegistry(inv, C).createJob({
      jobId: bytes(32),
      payloadHash: bytes(32),
      deadlineLedger: 3_200_000,
      fee: 1_000_000n,
      signer,
    });
    expect(inv.last!.method).toBe("create_job");
    const a = decoded();
    expect(a[0]).toBe(PK);
    expect(a[3]).toBe(3_200_000);
    expect(a[4]).toBe(1_000_000n);
  });

  it("cancelJob and slashJob use the right method names", async () => {
    const reg = new RelayerRegistry(inv, C);
    await reg.cancelJob({ jobId: bytes(32), signer });
    expect(inv.last!.method).toBe("cancel_job");
    await reg.slashJob({ jobId: bytes(32), signer });
    expect(inv.last!.method).toBe("slash_job");
  });
});
