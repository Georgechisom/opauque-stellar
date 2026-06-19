/**
 * End-to-end facade test: drive the real OpaqueClient and its services through a
 * stub invoker that captures contract calls and feeds read results. Verifies the
 * full path config -> service -> binding -> invoke without a network, and that
 * not-wired capabilities fail explicitly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import {
  OpaqueClient,
  keypairSigner,
  fromScVal,
  NotWiredError,
  SignerError,
  RpcError,
  TESTNET_DEPLOYMENT,
  type ContractInvoker,
  type InvokeOptions,
  type ReadOptions,
} from "../../src/index";

class StubInvoker implements ContractInvoker {
  last?: InvokeOptions;
  calls: InvokeOptions[] = [];
  reads: unknown[] = [];
  async invoke(opts: InvokeOptions): Promise<string> {
    this.last = opts;
    this.calls.push(opts);
    return "TXHASH";
  }
  async readNative<T>(_opts: ReadOptions): Promise<T> {
    return this.reads.shift() as T;
  }
  async simulateRead(): Promise<xdr.ScVal | undefined> {
    return undefined;
  }
}

const signer = keypairSigner(Keypair.random());
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

let inv: StubInvoker;
let client: OpaqueClient;
beforeEach(() => {
  inv = new StubInvoker();
  client = new OpaqueClient({ network: "testnet", signer, invoker: inv });
});

describe("OpaqueClient wiring", () => {
  it("resolves testnet config and exposes services + bindings", () => {
    expect(client.config.network).toBe("testnet");
    expect(client.contracts.privacyPool.contractId).toBe(
      TESTNET_DEPLOYMENT.contracts.privacyPool,
    );
    expect(client.payments).toBeDefined();
    expect(client.pool).toBeDefined();
    expect(client.reputation).toBeDefined();
    expect(client.schemas).toBeDefined();
    expect(client.relayer).toBeDefined();
  });

  it("throws SignerError when an operation needs a signer but none is set", () => {
    const readonly = new OpaqueClient({ network: "testnet", invoker: inv });
    expect(() => readonly.requireSigner()).toThrow(SignerError);
  });

  it("native transfers require the built-in RpcClient", () => {
    expect(() =>
      client.sendNativeTransfer({ destination: "G", amountStroops: 1n, signer }),
    ).toThrow(RpcError);
  });
});

describe("schemas service", () => {
  it("computes the schema id and registers it", async () => {
    const { schemaId, txHash } = await client.schemas.register({
      name: "credit",
      fieldDefinitions: "u64 score, bool verified",
      revocable: true,
      schemaExpiryLedger: 5_000_000,
    });
    expect(schemaId.length).toBe(32);
    expect(txHash).toBe("TXHASH");
    expect(inv.last!.method).toBe("register_schema");
    // schemaId arg (index 2) matches the computed id
    expect(Array.from(fromScVal(inv.last!.args[2]) as Uint8Array)).toEqual(
      Array.from(schemaId),
    );
  });
});

describe("payments service", () => {
  it("derives an identity and meta-address", () => {
    const id = client.payments.deriveIdentity("0x" + "ab".repeat(64));
    expect(id.metaHex).toMatch(/^0x[0-9a-f]{132}$/);
    expect(id.metaAddress.length).toBe(66);
  });

  it("registers a meta-address", async () => {
    const id = client.payments.deriveIdentity("0x" + "cd".repeat(64));
    await client.payments.register({ metaAddress: id.metaAddress });
    expect(inv.last!.method).toBe("register_keys");
  });

  it("scan() is not wired", () => {
    expect(() => client.payments.scan()).toThrow(NotWiredError);
  });
});

describe("reputation service", () => {
  it("submits a proof to verify_reputation with the configured groth16 verifier", async () => {
    await client.reputation.verifyOnChain({
      proofA: bytes(64),
      proofB: bytes(128),
      proofC: bytes(64),
      merkleRoot: bytes(32, 1),
      attestationId: bytes(32, 2),
      externalNullifier: 42n,
      nullifierHash: bytes(32, 3),
    });
    expect(inv.last!.method).toBe("verify_reputation");
    // arg[1] is the groth16 verifier address from config
    expect(fromScVal(inv.last!.args[1])).toBe(
      TESTNET_DEPLOYMENT.contracts.groth16Verifier,
    );
    expect(fromScVal(inv.last!.args[7])).toBe(42n); // external nullifier u64
  });

  it("prove() is not wired", () => {
    expect(() => client.reputation.prove()).toThrow(NotWiredError);
  });
});

describe("pool service", () => {
  it("deposits: reads the index, derives the commitment, persists the note", async () => {
    inv.reads.push(5); // get_deposit_count
    const { note, txHash } = await client.pool.deposit({ amountXlm: "5" });
    expect(txHash).toBe("TXHASH");
    expect(inv.last!.method).toBe("deposit");
    expect(note.leafIndex).toBe(5);
    expect(note.value).toBe("50000000"); // 5 XLM in stroops
    expect(note.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    // deposit arg[3] is the u64 expected index
    expect(fromScVal(inv.last!.args[3])).toBe(5n);
    // note persisted
    expect((await client.notes.list()).length).toBe(1);
  });

  it("withdraws with a precomputed proof and marks the note spent", async () => {
    await client.notes.add({
      cluster: "testnet",
      value: "50000000",
      scope: 1,
      leafIndex: 0,
      nullifier: "1",
      secret: "2",
      commitment: "0xabc",
      spent: false,
      createdAt: 0,
    });
    await client.pool.withdraw({
      proof: {
        proofA: bytes(64),
        proofB: bytes(128),
        proofC: bytes(64),
        withdrawnValue: 50_000_000n,
        stateRoot: bytes(32),
        aspRoot: bytes(32),
        nullifierHash: bytes(32),
        newCommitment: bytes(32),
      },
      recipient: "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU",
      noteCommitment: "0xabc",
    });
    expect(inv.last!.method).toBe("withdraw");
    const spent = (await client.notes.list()).find((n) => n.commitment === "0xabc");
    expect(spent?.spent).toBe(true);
  });

  it("proveWithdraw() is not wired", () => {
    expect(() => client.pool.proveWithdraw()).toThrow(NotWiredError);
  });
});

describe("relayer service", () => {
  it("creates a job", async () => {
    await client.relayer.createJob({
      jobId: bytes(32),
      payloadHash: bytes(32),
      deadlineLedger: 3_200_000,
      fee: 1_000_000n,
    });
    expect(inv.last!.method).toBe("create_job");
  });

  it("useGateway() is not wired", () => {
    expect(() => client.relayer.useGateway()).toThrow(NotWiredError);
  });
});
