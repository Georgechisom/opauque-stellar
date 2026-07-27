/**
 * Thread entry point for the proof worker pool. Runs inside a Node
 * `worker_thread` or a browser module `Worker` — never imported by the main
 * thread bundle directly, only loaded by URL (see `worker-pool.ts`). Each
 * message is one `snarkjs.groth16.fullProve` call; `snarkjs` is imported here,
 * inside the worker, since functions (and thus a caller-injected stub) can't
 * cross the thread boundary.
 */
export interface WorkerJobMessage {
  input: Record<string, unknown>;
  wasm: string | Uint8Array;
  zkey: string | Uint8Array;
}

export interface WorkerResultMessage {
  ok: true;
  proof: unknown;
  publicSignals: string[];
}

export interface WorkerErrorMessage {
  ok: false;
  error: string;
}

async function runJob(
  job: WorkerJobMessage,
): Promise<WorkerResultMessage | WorkerErrorMessage> {
  try {
    const snarkjs = (await import("snarkjs")) as unknown as {
      groth16: {
        fullProve(
          input: Record<string, unknown>,
          wasm: string | Uint8Array,
          zkey: string | Uint8Array,
        ): Promise<{ proof: unknown; publicSignals: string[] }>;
      };
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      job.input,
      job.wasm,
      job.zkey,
    );
    return { ok: true, proof, publicSignals };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

declare const self: {
  onmessage: ((ev: { data: WorkerJobMessage }) => void) | null;
  postMessage: (msg: unknown) => void;
} | undefined;

async function main(): Promise<void> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { parentPort } = await import("node:worker_threads");
    if (!parentPort) return;
    parentPort.on("message", (job: WorkerJobMessage) => {
      runJob(job).then((result) => parentPort.postMessage(result));
    });
    return;
  }
  if (typeof self !== "undefined") {
    self.onmessage = (ev) => {
      runJob(ev.data).then((result) => self!.postMessage(result));
    };
  }
}

void main();
