/**
 * Soroban RPC client. Holds resolved config, a signer, and observability hooks,
 * and exposes contract `invoke` (write) and `read` (read-only simulate) with
 * multi-endpoint read fallback, bounded polling, typed errors, and decoded
 * diagnostics. No ambient globals: everything comes from {@link ResolvedConfig}.
 */
import {
  BASE_FEE,
  Contract,
  Horizon,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { ResolvedConfig } from "../config/index";
import type { OpaqueSigner } from "../signer/index";
import { silentLogger, type Logger } from "../logger/index";
import { noopTelemetry, type Telemetry } from "../telemetry/index";
import {
  ContractError,
  RpcError,
  SimulationError,
} from "../errors/index";
import { contractErrorName } from "../errors/index";
import { decodeDiagnostics, extractContractErrorCode } from "./diagnostics";

const READ_TIMEOUT_MS = 12_000;
const READ_RETRIES_PER_PROVIDER = 2;
const TX_POLL_TIMEOUT_MS = 60_000;
const TX_POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableReadError(err: unknown): boolean {
  const status =
    typeof err === "object" && err !== null && "response" in err
      ? (err as { response?: { status?: number } }).response?.status
      : undefined;
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|rate.?limit|too many requests|network|fetch/i.test(message);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RpcError(`${label} timed out after ${READ_TIMEOUT_MS}ms`)),
      READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RpcClientOptions {
  config: ResolvedConfig;
  logger?: Logger;
  telemetry?: Telemetry;
}

export interface InvokeOptions {
  source: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  signer: OpaqueSigner;
  /** Skip pre-flight simulation (default false). */
  skipSimulation?: boolean;
  /** Contract package name for error naming (e.g. "reputation-verifier"). */
  contractPackage?: string;
}

export interface ReadOptions {
  source: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}

export class RpcClient {
  readonly config: ResolvedConfig;
  private readonly logger: Logger;
  private readonly telemetry: Telemetry;
  private readonly servers: rpc.Server[];

  constructor(opts: RpcClientOptions) {
    this.config = opts.config;
    this.logger = opts.logger ?? silentLogger;
    this.telemetry = opts.telemetry ?? noopTelemetry;
    this.servers = opts.config.rpcUrls.map(
      (url) => new rpc.Server(url, { allowHttp: url.startsWith("http://") }),
    );
    if (this.servers.length === 0) {
      throw new RpcError("RpcClient requires at least one RPC URL");
    }
  }

  /** Primary Soroban RPC server. */
  get server(): rpc.Server {
    return this.servers[0];
  }

  /** Horizon server (first configured Horizon URL). */
  horizon(): Horizon.Server {
    return new Horizon.Server(this.config.horizonUrls[0]);
  }

  /** Run a read across providers with retry + timeout; throws RpcError on exhaustion. */
  private async read<T>(fn: (server: rpc.Server) => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;
    for (const server of this.servers) {
      for (let attempt = 0; attempt < READ_RETRIES_PER_PROVIDER; attempt += 1) {
        try {
          return await withTimeout(fn(server), label);
        } catch (err) {
          lastError = err;
          if (!isRetryableReadError(err)) throw err;
          if (attempt + 1 < READ_RETRIES_PER_PROVIDER) await sleep(350 * (attempt + 1));
        }
      }
    }
    throw lastError instanceof Error
      ? new RpcError(`${label} failed: ${lastError.message}`, { cause: lastError })
      : new RpcError(`${label} failed`);
  }

  private async poll(txHash: string): Promise<rpc.Api.GetTransactionResponse> {
    const start = Date.now();
    while (Date.now() - start < TX_POLL_TIMEOUT_MS) {
      const res = await this.server.getTransaction(txHash);
      if (res.status !== "NOT_FOUND") return res;
      await sleep(TX_POLL_INTERVAL_MS);
    }
    throw new RpcError(`Transaction polling timed out for ${txHash}`);
  }

  /** Read-only contract call via simulation. Returns the decoded return ScVal. */
  async simulateRead(opts: ReadOptions): Promise<xdr.ScVal | undefined> {
    const account = await this.read(
      (s) => s.getAccount(opts.source),
      "getAccount",
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.passphrase,
    })
      .addOperation(new Contract(opts.contractId).call(opts.method, ...opts.args))
      .setTimeout(60)
      .build();

    const sim = await this.read(
      (s) => s.simulateTransaction(tx),
      `simulate ${opts.method}`,
    );
    if (rpc.Api.isSimulationError(sim)) {
      throw new SimulationError(`Simulation failed for ${opts.method}`, {
        diagnostics: sim.error,
      });
    }
    return sim.result?.retval;
  }

  /** Read-only contract call returning the native-decoded value. */
  async readNative<T = unknown>(opts: ReadOptions): Promise<T> {
    const retval = await this.simulateRead(opts);
    return (retval ? scValToNative(retval) : undefined) as T;
  }

  /** Invoke a contract method as a signed transaction. Returns the tx hash. */
  async invoke(opts: InvokeOptions): Promise<string> {
    const start = Date.now();
    try {
      const account = await this.read(
        (s) => s.getAccount(opts.source),
        "getAccount",
      );
      const raw = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.config.passphrase,
      })
        .addOperation(new Contract(opts.contractId).call(opts.method, ...opts.args))
        .setTimeout(180)
        .build();

      let prepared = raw;
      if (!opts.skipSimulation) {
        const sim = await this.server.simulateTransaction(raw);
        if (rpc.Api.isSimulationError(sim)) {
          throw new SimulationError(`Simulation failed for ${opts.method}`, {
            diagnostics: sim.error,
          });
        }
        prepared = rpc.assembleTransaction(raw, sim).build();
      } else {
        prepared = await this.server.prepareTransaction(raw);
      }

      const signedXdr = await opts.signer.signTransaction(prepared.toXDR(), {
        networkPassphrase: this.config.passphrase,
      });
      const signed = TransactionBuilder.fromXDR(signedXdr, this.config.passphrase);
      const send = await this.server.sendTransaction(
        signed as Parameters<rpc.Server["sendTransaction"]>[0],
      );
      if (send.status === "ERROR") {
        throw new RpcError(`sendTransaction rejected: ${JSON.stringify(send.errorResult)}`);
      }

      const result = await this.poll(send.hash);
      if (result.status !== "SUCCESS") {
        throw this.toContractError(opts, result);
      }

      this.telemetry.onContractCall?.({
        contractId: opts.contractId,
        method: opts.method,
        success: true,
        durationMs: Date.now() - start,
      });
      return send.hash;
    } catch (err) {
      this.telemetry.onContractCall?.({
        contractId: opts.contractId,
        method: opts.method,
        success: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private toContractError(
    opts: InvokeOptions,
    result: rpc.Api.GetTransactionResponse,
  ): Error {
    const events =
      (result as unknown as { diagnosticEventsXdr?: unknown[] }).diagnosticEventsXdr ?? [];
    const diagnostics = events.length ? decodeDiagnostics(events) : "";
    const code = events.length ? extractContractErrorCode(events) : null;
    if (code !== null) {
      return new ContractError({
        contract: opts.contractPackage ?? opts.contractId,
        contractCode: code,
        errorName: opts.contractPackage
          ? contractErrorName(opts.contractPackage, code)
          : undefined,
      });
    }
    this.logger.error(`tx ${result.status}`, diagnostics);
    return new RpcError(
      `Transaction ${result.status}` + (diagnostics ? `: ${diagnostics}` : ""),
    );
  }
}
