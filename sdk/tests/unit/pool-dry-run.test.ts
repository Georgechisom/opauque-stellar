/**
 * Withdrawal dry run (issue: dry-run mode for pool withdrawals). Verifies the
 * full flow — proof generation + transaction simulation, no submission — using
 * a stubbed snarkjs (no real circuit artifacts needed) and a stubbed invoker
 * whose `invoke` throws if ever called, proving a dry run never touches the
 * on-chain nullifier set.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import {
  PrivacyPool,
  StealthRegistry,
  StealthAnnouncer,
  SchemaRegistry,
  AttestationEngine,
  Groth16Verifier,
  ReputationVerifier,
  RelayerRegistry,
  keypairSigner,
  deriveDeposit,
  newNoteSecrets,
  toHex32,
  MemoryNoteStore,
  MemoryScanStore,
  MemoryVaultStore,
  PoolService,
  type ArtifactResolver,
  type ContractInvoker,
  type InvokeOptions,
  type OpaqueClientContext,
  type ResolvedConfig,
  type SimulateInvokeOptions,
  type SimulationReport,
  type PoolNote,
} from "../../src/index";

const C = "CAIXWMGYZR3YAQ3CPCXOU42WG62E3ARUSG4GDHHDMNRXUD44YSGE5VXW";
const RECIPIENT = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";
const SCOPE = 1;

const FAKE_SIMULATION: SimulationReport = {
  minResourceFeeStroops: 12_345n,
  resources: { cpuInstructions: 1_000_000, readBytes: 2_048, writeBytes: 512 },
  returnValue: undefined,
};

class StubInvoker implements ContractInvoker {
  invokeCalls: InvokeOptions[] = [];
  simulateInvokeCalls: SimulateInvokeOptions[] = [];
  async invoke(opts: InvokeOptions): Promise<string> {
    this.invokeCalls.push(opts);
    throw new Error("invoke() must never be called during a dry run");
  }
  async readNative<T>(): Promise<T> {
    throw new Error("not used");
  }
  async simulateRead(): Promise<xdr.ScVal | undefined> {
    throw new Error("not used");
  }
  async getEvents(): Promise<rpc.Api.GetEventsResponse> {
    return { events: [], latestLedger: 0, cursor: "" } as unknown as rpc.Api.GetEventsResponse;
  }
  async getLatestLedger(): Promise<number> {
    return 0;
  }
  async simulateInvoke(opts: SimulateInvokeOptions): Promise<SimulationReport> {
    this.simulateInvokeCalls.push(opts);
    return FAKE_SIMULATION;
  }
}

const fakeSnarkjs = {
  groth16: {
    async fullProve() {
      return {
        proof: {
          pi_a: ["1", "2"],
          pi_b: [
            ["3", "4"],
            ["5", "6"],
          ],
          pi_c: ["7", "8"],
        },
        publicSignals: [],
      };
    },
  },
};

const fakeArtifacts: ArtifactResolver = {
  async resolve() {
    return "unused";
  },
};

let inv: StubInvoker;
beforeEach(() => {
  inv = new StubInvoker();
});

function buildContext(): OpaqueClientContext {
  const signer = keypairSigner(Keypair.random());
  const config = {
    network: "testnet",
    passphrase: "Test SDF Network ; September 2015",
    rpcUrls: ["https://example.invalid"],
    horizonUrls: ["https://example.invalid"],
    contracts: {
      stealthRegistry: C,
      stealthAnnouncer: C,
      groth16Verifier: C,
      reputationVerifier: C,
      schemaRegistry: C,
      attestationEngineV2: C,
      poolVerifier: C,
      privacyPool: C,
      relayerRegistry: C,
    },
    pool: { scope: SCOPE, nativeSac: "CNATIVESAC" },
    relayer: { minimumStake: 0n, unstakeCooldownLedgers: 0, maxDeadlineLedgers: 0, gatewayUrls: [] },
    relayerGatewayUrls: [],
    startLedger: 0,
  } satisfies ResolvedConfig;

  return {
    config,
    rpc: inv,
    contracts: {
      stealthRegistry: new StealthRegistry(inv, C),
      stealthAnnouncer: new StealthAnnouncer(inv, C),
      schemaRegistry: new SchemaRegistry(inv, C),
      attestationEngine: new AttestationEngine(inv, C),
      groth16Verifier: new Groth16Verifier(inv, C),
      reputationVerifier: new ReputationVerifier(inv, C),
      privacyPool: new PrivacyPool(inv, C),
      relayerRegistry: new RelayerRegistry(inv, C),
    },
    notes: new MemoryNoteStore(),
    vault: new MemoryVaultStore(),
    scanStore: new MemoryScanStore(),
    signer,
    artifacts: fakeArtifacts,
    requireSigner: () => signer,
    sendNativeTransfer: async () => "TXHASH",
  };
}

async function buildNote(): Promise<PoolNote> {
  const value = 1_000_000n;
  const leafIndex = 0;
  const secrets = newNoteSecrets();
  const { commitment } = await deriveDeposit({
    value,
    scope: SCOPE,
    leafIndex,
    nullifier: BigInt(secrets.nullifier),
    secret: BigInt(secrets.secret),
  });
  return {
    cluster: "testnet",
    poolId: C,
    value: value.toString(),
    scope: SCOPE,
    leafIndex,
    nullifier: secrets.nullifier,
    secret: secrets.secret,
    commitment: toHex32(commitment),
    spent: false,
    createdAt: 0,
  };
}

describe("PoolService.dryRunWithdraw", () => {
  it("generates a proof and simulates, without ever invoking a real submission", async () => {
    const ctx = buildContext();
    const pool = new PoolService(ctx);
    const note = await buildNote();
    const stateLeaves = [BigInt("0x" + note.commitment.slice(2))];

    const result = await pool.dryRunWithdraw({
      note,
      recipient: RECIPIENT,
      fee: 10_000n,
      stateLeaves,
      depositIndices: [note.leafIndex],
      snarkjs: fakeSnarkjs,
    });

    expect(inv.invokeCalls.length).toBe(0);
    expect(inv.simulateInvokeCalls.length).toBe(1);
    expect(inv.simulateInvokeCalls[0].method).toBe("withdraw");

    expect(result.fee).toBe(10_000n);
    expect(result.expectedPayout).toBe(result.proof.withdrawnValue - 10_000n);
    expect(result.simulation).toEqual(FAKE_SIMULATION);
    expect(result.proof.proofA.length).toBe(64);
  });

  it("defaults relayer to recipient and fee to zero", async () => {
    const ctx = buildContext();
    const pool = new PoolService(ctx);
    const note = await buildNote();
    const stateLeaves = [BigInt("0x" + note.commitment.slice(2))];

    const result = await pool.dryRunWithdraw({
      note,
      recipient: RECIPIENT,
      stateLeaves,
      depositIndices: [note.leafIndex],
      snarkjs: fakeSnarkjs,
    });

    expect(result.relayer).toBe(RECIPIENT);
    expect(result.fee).toBe(0n);
    expect(result.expectedPayout).toBe(result.proof.withdrawnValue);
  });
});
