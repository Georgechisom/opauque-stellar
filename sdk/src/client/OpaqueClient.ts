/**
 * The high-level entry point. One config + one signer wires the resolved network,
 * RPC client, contract bindings, storage, and the domain services
 * (`payments`, `pool`, `reputation`, `schemas`, `relayer`). Low-level escape
 * hatches (`rpc`, `contracts`, `soroban`) are exposed for advanced use.
 */
import { resolveConfig, type OpaqueConfig, type ResolvedConfig } from "../config/index";
import { RpcClient, type ContractInvoker } from "../rpc/client";
import type { OpaqueSigner } from "../signer/index";
import type { Logger } from "../logger/index";
import type { Telemetry } from "../telemetry/index";
import type { ArtifactResolver } from "../artifacts/index";
import {
  MemoryNoteStore,
  MemoryScanStore,
  MemoryVaultStore,
  type NoteStore,
  type ScanStore,
  type VaultStore,
} from "../storage/index";
import {
  AttestationEngine,
  Groth16Verifier,
  PrivacyPool,
  RelayerRegistry,
  ReputationVerifier,
  SchemaRegistry,
  StealthAnnouncer,
  StealthRegistry,
} from "../contracts/index";
import { RpcError, SignerError } from "../errors/index";
import {
  PaymentsService,
  PoolService,
  RelayerService,
  ReputationService,
  SchemasService,
  type ContractBindings,
  type OpaqueClientContext,
} from "../services/index";

export interface OpaqueClientOptions extends OpaqueConfig {
  signer?: OpaqueSigner;
  storage?: { notes?: NoteStore; vault?: VaultStore; scan?: ScanStore };
  logger?: Logger;
  telemetry?: Telemetry;
  /** Circuit artifact resolver; enables proof generation when provided. */
  artifacts?: ArtifactResolver;
  /** Advanced / testing: inject a custom invoker instead of the built-in RpcClient. */
  invoker?: ContractInvoker;
}

export class OpaqueClient implements OpaqueClientContext {
  readonly config: ResolvedConfig;
  readonly rpc: ContractInvoker;
  readonly contracts: ContractBindings;
  readonly notes: NoteStore;
  readonly vault: VaultStore;
  readonly scanStore: ScanStore;
  readonly signer?: OpaqueSigner;
  readonly artifacts?: ArtifactResolver;

  readonly payments: PaymentsService;
  readonly pool: PoolService;
  readonly reputation: ReputationService;
  readonly schemas: SchemasService;
  readonly relayer: RelayerService;

  private readonly rpcClient?: RpcClient;

  constructor(opts: OpaqueClientOptions) {
    this.config = resolveConfig(opts);
    this.rpcClient = opts.invoker
      ? undefined
      : new RpcClient({
          config: this.config,
          logger: opts.logger,
          telemetry: opts.telemetry,
        });
    this.rpc = opts.invoker ?? (this.rpcClient as RpcClient);
    this.signer = opts.signer;
    this.artifacts = opts.artifacts;
    this.notes = opts.storage?.notes ?? new MemoryNoteStore();
    this.vault = opts.storage?.vault ?? new MemoryVaultStore();
    this.scanStore = opts.storage?.scan ?? new MemoryScanStore();

    const c = this.config.contracts;
    this.contracts = {
      stealthRegistry: new StealthRegistry(this.rpc, c.stealthRegistry),
      stealthAnnouncer: new StealthAnnouncer(this.rpc, c.stealthAnnouncer),
      schemaRegistry: new SchemaRegistry(this.rpc, c.schemaRegistry),
      attestationEngine: new AttestationEngine(this.rpc, c.attestationEngineV2),
      groth16Verifier: new Groth16Verifier(this.rpc, c.groth16Verifier),
      reputationVerifier: new ReputationVerifier(this.rpc, c.reputationVerifier),
      privacyPool: new PrivacyPool(this.rpc, c.privacyPool),
      relayerRegistry: new RelayerRegistry(this.rpc, c.relayerRegistry),
    };

    this.schemas = new SchemasService(this);
    this.payments = new PaymentsService(this);
    this.pool = new PoolService(this);
    this.relayer = new RelayerService(this);
    this.reputation = new ReputationService(this, this.schemas);
  }

  /** The built-in Soroban/Horizon client, or undefined when a custom invoker was injected. */
  get soroban(): RpcClient | undefined {
    return this.rpcClient;
  }

  /** Returns the configured signer or throws if none was set. */
  requireSigner(): OpaqueSigner {
    if (!this.signer) {
      throw new SignerError(
        "This operation requires a signer. Construct OpaqueClient with { signer }.",
      );
    }
    return this.signer;
  }

  /** Send a native XLM transfer through the built-in RpcClient. */
  sendNativeTransfer(opts: {
    destination: string;
    amountStroops: bigint;
    signer: OpaqueSigner;
  }): Promise<string> {
    if (!this.rpcClient) {
      throw new RpcError(
        "Native transfers require the built-in RpcClient (unavailable with a custom invoker).",
      );
    }
    return this.rpcClient.sendNativeTransfer(opts);
  }
}
