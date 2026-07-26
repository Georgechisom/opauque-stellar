/**
 * `provePoolWithdrawBatch` wiring: witness building for each note, dispatch
 * through the worker-pool engine, and reassembly into per-note proof bundles.
 * Byte-identical serial-vs-parallel determinism for the dispatch mechanism
 * itself is covered exhaustively in worker-pool.test.ts (with fixed inputs,
 * free of the fresh-randomness the withdrawal witness's change note draws per
 * call); this test checks the layer above wires it correctly.
 */
import { describe, it, expect } from "vitest";
import {
  deriveDeposit,
  newNoteSecrets,
  toHex32,
  provePoolWithdrawBatch,
  type PoolNote,
  type ArtifactResolver,
} from "../../src/index";
import type {
  ProveJob,
  ProveJobResult,
  WorkerTransport,
} from "../../src/prove/worker-pool";

const RECIPIENT = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";
const SCOPE = 1;

const fakeArtifacts: ArtifactResolver = {
  async resolve() {
    return "unused";
  },
};

const fakeSnarkjs = {
  groth16: {
    async fullProve(
      input: Record<string, unknown>,
      _wasm: string | Uint8Array,
      _zkey: string | Uint8Array,
    ): Promise<ProveJobResult> {
      // Echo the deterministic public inputs into the "proof" so we can assert
      // each result was built from the right note's witness.
      const tag = BigInt(input.withdrawnValue as string) + BigInt(input.nullifierHash as string);
      return {
        proof: { pi_a: [tag.toString(), "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
        publicSignals: [],
      };
    },
  },
};

async function buildNote(value: bigint, leafIndex: number): Promise<PoolNote> {
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

class FakeWorkerTransport implements WorkerTransport {
  execCalls: ProveJob[] = [];
  async exec(job: ProveJob): Promise<ProveJobResult> {
    this.execCalls.push(job);
    return fakeSnarkjs.groth16.fullProve(job.input, job.wasm, job.zkey);
  }
  async terminate(): Promise<void> {}
}

describe("provePoolWithdrawBatch", () => {
  it("proves each note and returns results in input order (serial path)", async () => {
    const noteA = await buildNote(1_000_000n, 0);
    const noteB = await buildNote(2_000_000n, 1);
    const stateLeaves = [
      BigInt("0x" + noteA.commitment.slice(2)),
      BigInt("0x" + noteB.commitment.slice(2)),
    ];

    const results = await provePoolWithdrawBatch({
      jobs: [
        { note: noteA, recipient: RECIPIENT, stateLeaves, depositIndices: [0, 1] },
        { note: noteB, recipient: RECIPIENT, stateLeaves, depositIndices: [0, 1] },
      ],
      artifacts: fakeArtifacts,
      snarkjs: fakeSnarkjs,
      pool: false,
    });

    expect(results).toHaveLength(2);
    expect(results[0].withdrawnValue).toBe(1_000_000n);
    expect(results[1].withdrawnValue).toBe(2_000_000n);
    // Different notes must not collide on the proof bytes.
    expect(results[0].nullifierHash).not.toEqual(results[1].nullifierHash);
  });

  it("dispatches every job through an injected worker transport", async () => {
    const noteA = await buildNote(1_000_000n, 0);
    const noteB = await buildNote(2_000_000n, 1);
    const stateLeaves = [
      BigInt("0x" + noteA.commitment.slice(2)),
      BigInt("0x" + noteB.commitment.slice(2)),
    ];
    const transport = new FakeWorkerTransport();

    const results = await provePoolWithdrawBatch({
      jobs: [
        { note: noteA, recipient: RECIPIENT, stateLeaves, depositIndices: [0, 1] },
        { note: noteB, recipient: RECIPIENT, stateLeaves, depositIndices: [0, 1] },
      ],
      artifacts: fakeArtifacts,
      snarkjs: fakeSnarkjs,
      pool: { transport },
    });

    expect(transport.execCalls).toHaveLength(2);
    expect(results.map((r) => r.withdrawnValue)).toEqual([1_000_000n, 2_000_000n]);
  });
});
