/**
 * Proof worker-pool engine (issue: worker pool for concurrent proof
 * generation). `runProofJobs` is the shared dispatcher behind
 * `provePoolWithdrawBatch` / `proveReputationV2Batch`. These tests cover the
 * three acceptance criteria directly:
 *  - constrained environments (no worker runtime found) fall back to serial
 *  - serial and "parallel" (a fake worker transport) produce identical output
 *    for fixed inputs
 *  - a single job always takes the serial path, never touching a transport
 */
import { describe, it, expect } from "vitest";
import {
  runProofJobs,
  type ProveJob,
  type ProveJobResult,
  type WorkerTransport,
  type SnarkjsLike,
} from "../../src/prove/worker-pool";

/** Deterministic stand-in for snarkjs: output is a pure function of the input. */
const fakeSnarkjs: SnarkjsLike = {
  groth16: {
    async fullProve(input: Record<string, unknown>): Promise<ProveJobResult> {
      const marker = JSON.stringify(input);
      return {
        proof: {
          pi_a: [String(marker.length), "2"],
          pi_b: [
            ["3", "4"],
            ["5", "6"],
          ],
          pi_c: ["7", "8"],
        },
        publicSignals: [String(marker.length)],
      };
    },
  },
};

function job(n: number): ProveJob {
  return { input: { n }, wasm: "wasm", zkey: "zkey" };
}

/** Simulates a pool of worker threads by calling the injected snarkjs directly. */
class FakeWorkerTransport implements WorkerTransport {
  execCalls: ProveJob[] = [];
  terminated = false;
  async exec(job: ProveJob): Promise<ProveJobResult> {
    this.execCalls.push(job);
    return fakeSnarkjs.groth16.fullProve(job.input, job.wasm, job.zkey);
  }
  async terminate(): Promise<void> {
    this.terminated = true;
  }
}

describe("runProofJobs", () => {
  const jobs = [job(1), job(2), job(3)];

  it("runs serially, in order, when pool is disabled", async () => {
    const results = await runProofJobs(jobs, { snarkjs: fakeSnarkjs, pool: false });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.publicSignals[0])).toEqual(
      jobs.map((j) => String(JSON.stringify(j.input).length)),
    );
  });

  it("produces byte-identical results through an injected worker transport", async () => {
    const serial = await runProofJobs(jobs, { snarkjs: fakeSnarkjs, pool: false });
    const transport = new FakeWorkerTransport();
    const parallel = await runProofJobs(jobs, {
      snarkjs: fakeSnarkjs,
      pool: { transport },
    });
    expect(parallel).toEqual(serial);
    expect(transport.execCalls).toHaveLength(3);
  });

  it("does not terminate a caller-supplied transport (caller owns its lifecycle)", async () => {
    const transport = new FakeWorkerTransport();
    await runProofJobs(jobs, { snarkjs: fakeSnarkjs, pool: { transport } });
    expect(transport.terminated).toBe(false);
  });

  it("falls back to serial in a constrained environment with no worker runtime available", async () => {
    // No transport injected and no built worker bundle exists next to
    // src/prove — this is exactly "no worker runtime available".
    const results = await runProofJobs(jobs, { snarkjs: fakeSnarkjs });
    expect(results.map((r) => r.publicSignals[0])).toEqual(
      jobs.map((j) => String(JSON.stringify(j.input).length)),
    );
  });

  it("always takes the serial path for a single job, never touching a transport", async () => {
    const transport = new FakeWorkerTransport();
    transport.exec = async () => {
      throw new Error("a single job must not be dispatched to a transport");
    };
    const results = await runProofJobs([job(1)], {
      snarkjs: fakeSnarkjs,
      pool: { transport },
    });
    expect(results).toHaveLength(1);
  });

  it("returns an empty array for no jobs without invoking snarkjs", async () => {
    const results = await runProofJobs([], {
      snarkjs: {
        groth16: {
          fullProve: async () => {
            throw new Error("must not be called");
          },
        },
      },
    });
    expect(results).toEqual([]);
  });
});
