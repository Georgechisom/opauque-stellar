/**
 * Concurrency engine for Groth16 proof generation. `snarkjs.groth16.fullProve`
 * is CPU-bound synchronous/WASM work; running several calls through `Promise.all`
 * on one thread does not parallelize it (Node/the browser main thread only ever
 * run one at a time). Real parallelism needs real OS threads, so the pool
 * dispatches to Node `worker_threads` or browser `Worker`s, each independently
 * importing `snarkjs` and proving one job at a time (see `worker-runtime.ts`).
 *
 * `runProofJobs` is the entry point `prove/pool.ts` and `prove/reputation.ts`
 * batch functions call: it picks a transport (explicit, then Node, then
 * browser), and falls back to serial, in-process proving whenever none is
 * available — no worker runtime asset, a single job, or `pool: false`.
 */
import { defaultPoolSize } from "./pool-size";

export interface ProveJob {
  input: Record<string, unknown>;
  wasm: string | Uint8Array;
  zkey: string | Uint8Array;
}

export interface ProveJobResult {
  proof: import("./serialize").Groth16ProofLike;
  publicSignals: string[];
}

export interface SnarkjsLike {
  groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: string | Uint8Array,
      zkey: string | Uint8Array,
    ): Promise<ProveJobResult>;
  };
}

/** One dispatch target: an OS worker (or a test double standing in for one). */
export interface WorkerTransport {
  exec(job: ProveJob): Promise<ProveJobResult>;
  terminate(): Promise<void>;
}

export interface ProofPoolOptions {
  /** Worker count. Defaults to available cores minus one (min 1). */
  size?: number;
  /**
   * Advanced/testing: use this transport instead of auto-detecting a Node or
   * browser worker runtime. Not terminated by `runProofJobs` — the caller owns
   * its lifecycle.
   */
  transport?: WorkerTransport;
}

interface RunProofJobsOptions {
  snarkjs?: SnarkjsLike;
  pool?: ProofPoolOptions | false;
}

async function loadSnarkjs(): Promise<SnarkjsLike> {
  return (await import("snarkjs")) as unknown as SnarkjsLike;
}

/** Run every job in-process, one after another. The universal fallback path. */
async function runSerial(jobs: ProveJob[], snarkjs: SnarkjsLike): Promise<ProveJobResult[]> {
  const results: ProveJobResult[] = [];
  for (const job of jobs) {
    results.push(await snarkjs.groth16.fullProve(job.input, job.wasm, job.zkey));
  }
  return results;
}

/** Minimal shape both `worker_threads.Worker` and browser `Worker` are adapted to. */
interface WorkerLike {
  postMessage(message: unknown): void;
  onMessage(cb: (data: unknown) => void): void;
  onError(cb: (err: unknown) => void): void;
  terminate(): void | Promise<void>;
}

/**
 * Fixed-size pool of {@link WorkerLike}s. Guarantees at most one in-flight job
 * per worker (a fresh one-shot listener is attached per dispatch), and queues
 * jobs past the worker count.
 */
class WorkerLikePool implements WorkerTransport {
  private idle: WorkerLike[];
  private queue: Array<{
    job: ProveJob;
    resolve: (r: ProveJobResult) => void;
    reject: (e: unknown) => void;
  }> = [];

  constructor(private readonly workers: WorkerLike[]) {
    this.idle = [...workers];
  }

  exec(job: ProveJob): Promise<ProveJobResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.shift()!;
      const next = this.queue.shift()!;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.idle.push(worker);
        fn();
        this.pump();
      };
      worker.onMessage((data) => {
        const msg = data as { ok: boolean; proof?: unknown; publicSignals?: string[]; error?: string };
        finish(() =>
          msg.ok
            ? next.resolve({ proof: msg.proof as ProveJobResult["proof"], publicSignals: msg.publicSignals! })
            : next.reject(new Error(msg.error)),
        );
      });
      worker.onError((err) => finish(() => next.reject(err)));
      worker.postMessage({ input: next.job.input, wasm: next.job.wasm, zkey: next.job.zkey });
    }
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/**
 * URL of the standalone worker-thread bundle. Resolved relative to wherever
 * this module's *compiled output* lands (a tsup entry emits it as
 * `prove-worker-runtime.js` next to `index.js`) — not the TypeScript source
 * layout, which is why running straight from `src/` (as tests do) can't find
 * it and correctly falls back to serial proving instead.
 */
function workerRuntimeUrl(): URL | null {
  try {
    return new URL("./prove-worker-runtime.js", import.meta.url);
  } catch {
    return null;
  }
}

/**
 * Node `worker_threads` transport. Returns null (triggering serial fallback)
 * when not running in Node, or the built worker bundle isn't present — e.g.
 * running straight from TypeScript sources rather than the compiled `dist/`.
 */
export async function createNodeWorkerTransport(size: number): Promise<WorkerTransport | null> {
  if (typeof process === "undefined" || !process.versions?.node) return null;
  const url = workerRuntimeUrl();
  if (!url) return null;
  let workerThreads: typeof import("node:worker_threads");
  let fs: typeof import("node:fs");
  try {
    [workerThreads, fs] = await Promise.all([import("node:worker_threads"), import("node:fs")]);
  } catch {
    return null;
  }
  if (url.protocol === "file:" && !fs.existsSync(url)) return null;

  const workers = Array.from({ length: size }, () => new workerThreads.Worker(url));
  const adapted: WorkerLike[] = workers.map((w) => ({
    postMessage: (m) => w.postMessage(m),
    onMessage: (cb) => w.once("message", cb),
    onError: (cb) => w.once("error", cb),
    terminate: async () => {
      await w.terminate();
    },
  }));
  return new WorkerLikePool(adapted);
}

/**
 * Browser `Worker` transport. Returns null (triggering serial fallback) when
 * `Worker` isn't available (Node, or a locked-down embedded webview).
 */
export async function createBrowserWorkerTransport(size: number): Promise<WorkerTransport | null> {
  if (typeof Worker === "undefined") return null;
  const url = workerRuntimeUrl();
  if (!url) return null;
  const workers = Array.from({ length: size }, () => new Worker(url, { type: "module" }));
  const adapted: WorkerLike[] = workers.map((w) => ({
    postMessage: (m) => w.postMessage(m),
    onMessage: (cb) => {
      const handler = (ev: MessageEvent) => {
        w.removeEventListener("message", handler);
        cb(ev.data);
      };
      w.addEventListener("message", handler);
    },
    onError: (cb) => {
      const handler = (ev: ErrorEvent) => {
        w.removeEventListener("error", handler);
        cb(ev.error ?? new Error(ev.message));
      };
      w.addEventListener("error", handler);
    },
    terminate: () => w.terminate(),
  }));
  return new WorkerLikePool(adapted);
}

async function createDefaultTransport(size: number): Promise<WorkerTransport | null> {
  if (typeof Worker !== "undefined") return createBrowserWorkerTransport(size);
  return createNodeWorkerTransport(size);
}

/**
 * Run proof-generation jobs, in parallel across a worker pool when one is
 * available, serially in-process otherwise. Job order is preserved in the
 * result array regardless of path taken.
 */
export async function runProofJobs(
  jobs: ProveJob[],
  opts: RunProofJobsOptions = {},
): Promise<ProveJobResult[]> {
  if (jobs.length === 0) return [];
  const snarkjs = opts.snarkjs ?? (await loadSnarkjs());

  if (opts.pool === false || jobs.length === 1) {
    return runSerial(jobs, snarkjs);
  }

  const size = Math.max(1, opts.pool?.size ?? (await defaultPoolSize()));
  const ownedTransport = opts.pool?.transport ? null : await createDefaultTransport(size);
  const transport = opts.pool?.transport ?? ownedTransport;
  if (!transport) {
    // Constrained environment: no worker runtime available.
    return runSerial(jobs, snarkjs);
  }

  // The transport (a fixed-size worker pool) throttles its own concurrency;
  // dispatching every job at once just fills its internal queue.
  try {
    return await Promise.all(jobs.map((job) => transport.exec(job)));
  } finally {
    if (ownedTransport) await ownedTransport.terminate();
  }
}
