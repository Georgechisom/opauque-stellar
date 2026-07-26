/**
 * PoolService.deposit validation wiring: confirms the live-config precheck
 * (issue: deposit amount validation against pool configuration) runs before the
 * on-chain deposit call, can be bypassed with `skipValidation`, and that a
 * failed validation never reaches the invoker (no fee spent on a doomed tx).
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
  MemoryNoteStore,
  MemoryScanStore,
  MemoryVaultStore,
  PoolService,
  PoolValidationError,
  type ContractInvoker,
  type InvokeOptions,
  type OpaqueClientContext,
  type ResolvedConfig,
} from "../../src/index";

class StubInvoker implements ContractInvoker {
  invokeCalls: InvokeOptions[] = [];
  reads: Record<string, unknown> = {};
  async invoke(opts: InvokeOptions): Promise<string> {
    this.invokeCalls.push(opts);
    return "TXHASH";
  }
  async readNative<T>(opts: { method: string }): Promise<T> {
    if (opts.method in this.reads) return this.reads[opts.method] as T;
    throw new Error(`unstubbed read: ${opts.method}`);
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
}

const C = "CAIXWMGYZR3YAQ3CPCXOU42WG62E3ARUSG4GDHHDMNRXUD44YSGE5VXW";

function buildContext(inv: StubInvoker) {
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
    pool: { scope: 1, nativeSac: "CNATIVESAC" },
    relayer: { minimumStake: 0n, unstakeCooldownLedgers: 0, maxDeadlineLedgers: 0, gatewayUrls: [] },
    relayerGatewayUrls: [],
    startLedger: 0,
  } satisfies ResolvedConfig;

  const ctx: OpaqueClientContext = {
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
    requireSigner: () => signer,
    sendNativeTransfer: async () => "TXHASH",
  };
  return ctx;
}

let inv: StubInvoker;
beforeEach(() => {
  inv = new StubInvoker();
  inv.reads.get_config = {
    admin: "GADMIN",
    groth16_verifier: "CGROTH16",
    native_sac: "CNATIVESAC",
    scope: 1,
    root_expiry_ledgers: 17_280,
  };
  inv.reads.decimals = 7;
  inv.reads.get_deposit_count = 0;
});

describe("PoolService.deposit validation", () => {
  it("rejects an amount with more precision than the live asset config allows, before touching the invoker", async () => {
    inv.reads.decimals = 2; // live config allows only 2 decimals
    const ctx = buildContext(inv);
    const pool = new PoolService(ctx);
    await expect(pool.deposit({ amountXlm: "1.234" })).rejects.toThrow(PoolValidationError);
    expect(inv.invokeCalls.length).toBe(0);
  });

  it("allows a valid amount through to the deposit call", async () => {
    const ctx = buildContext(inv);
    const pool = new PoolService(ctx);
    const { txHash } = await pool.deposit({ amountXlm: "1.5" });
    expect(txHash).toBe("TXHASH");
    expect(inv.invokeCalls.length).toBe(1);
    expect(inv.invokeCalls[0].method).toBe("deposit");
  });

  it("skipValidation bypasses the precheck", async () => {
    inv.reads.decimals = 2; // would otherwise reject 7-decimal precision
    const ctx = buildContext(inv);
    const pool = new PoolService(ctx);
    const { txHash } = await pool.deposit({ amountXlm: "1.2345678", skipValidation: true });
    expect(txHash).toBe("TXHASH");
    expect(inv.invokeCalls.length).toBe(1);
  });
});
