/**
 * Typed error hierarchy tests (#562).
 *
 * The central guarantee under test: integrators branch on classes and codes, never
 * on message text. Every assertion here is deliberately written so that rewording a
 * message would not break it.
 */

import { describe, it, expect } from "vitest";
import {
  OPAQUE_ERROR_CLASSES,
  OpaqueError,
  NoteCommitmentMismatchError,
  NoteNotIndexedError,
  PoolNotDeployedError,
  PoolRootsStaleError,
  PoolRootsUnpublishedError,
  ProofArtifactUnavailableError,
  ProofError,
  ProofGenerationError,
  ProofRejectedError,
  RelayerError,
  RelayerGatewayError,
  RelayerJobFailedError,
  RelayerNoBidsError,
  RelayerNotConfiguredError,
  RpcRequestError,
  RpcRetriesExhaustedError,
  SimulationFailedError,
  SubmissionError,
  TransactionFailedError,
  TransactionRejectedError,
  TransactionTimeoutError,
  UnknownOpaqueError,
  VerificationError,
  findCause,
  hasErrorCode,
  isOpaqueError,
  isRetryable,
  toOpaqueError,
} from "../errors";

/** One representative instance of every documented class. */
function sampleErrors(): OpaqueError[] {
  return [
    new PoolNotDeployedError({ message: "m", network: "testnet" }),
    new RelayerNotConfiguredError({ message: "m", network: "testnet" }),
    new NoteNotIndexedError({ message: "m", leafIndex: 3, indexedLeafIndices: [0, 1] }),
    new NoteCommitmentMismatchError({
      message: "m",
      leafIndex: 3,
      expectedCommitment: "0xaa",
      onChainCommitment: "0xbb",
    }),
    new PoolRootsUnpublishedError({
      message: "m",
      poolId: "C1",
      hasStateRoot: false,
      hasAspRoot: false,
    }),
    new PoolRootsStaleError({
      message: "m",
      poolId: "C1",
      stateRootMatches: true,
      aspRootMatches: false,
    }),
    new ProofArtifactUnavailableError({ message: "m", artifact: "a.zkey" }),
    new ProofGenerationError({ message: "m", circuit: "withdraw" }),
    new SimulationFailedError({ message: "m", contractId: "C1", method: "withdraw" }),
    new ProofRejectedError({ message: "m", contractId: "C1" }),
    new TransactionRejectedError({ message: "m", status: "ERROR" }),
    new TransactionFailedError({ message: "m", txHash: "abc", status: "FAILED" }),
    new TransactionTimeoutError({ message: "m", txHash: "abc", waitedMs: 60_000 }),
    new RpcRequestError({ message: "m", provider: "rpc", method: "getEvents" }),
    new RpcRetriesExhaustedError({
      message: "m",
      method: "getEvents",
      attempts: 3,
      providersTried: 1,
      elapsedMs: 10,
    }),
    new RelayerGatewayError({
      message: "m",
      gateway: "http://gw",
      operation: "bids",
      status: 503,
    }),
    new RelayerNoBidsError({ message: "m", jobIdHex: "ff", receivedBids: 0 }),
    new RelayerJobFailedError({ message: "m", jobIdHex: "ff", jobStatus: "slashed" }),
    new UnknownOpaqueError({ message: "m" }),
  ];
}

describe("error class registry (#562)", () => {
  it("documents exactly the classes that are exported as throwable", () => {
    expect(OPAQUE_ERROR_CLASSES).toHaveLength(sampleErrors().length);
  });

  it("makes every documented error an instance of OpaqueError and of Error", () => {
    for (const err of sampleErrors()) {
      expect(err).toBeInstanceOf(OpaqueError);
      expect(err).toBeInstanceOf(Error);
      expect(isOpaqueError(err)).toBe(true);
    }
  });

  it("gives every class a unique, stable code", () => {
    const codes = sampleErrors().map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps `name` explicit so minified builds still identify the class", () => {
    for (const err of sampleErrors()) {
      expect(err.name).toBe(err.constructor.name);
      expect(err.name).not.toBe("Error");
    }
  });

  it("freezes context so a consumer cannot mutate a shared error", () => {
    const err = new ProofGenerationError({ message: "m", circuit: "withdraw" });
    expect(() => {
      (err.context as Record<string, unknown>).circuit = "tampered";
    }).toThrow();
  });
});

describe("structured fields, not message parsing (#562)", () => {
  it("exposes proof failure detail as typed fields", () => {
    const err = new NoteNotIndexedError({
      message: "anything at all",
      leafIndex: 7,
      indexedLeafIndices: [0, 1, 2],
    });
    expect(err.leafIndex).toBe(7);
    expect(err.indexedLeafIndices).toEqual([0, 1, 2]);
    expect(err.context.indexedCount).toBe(3);
  });

  it("copies the indexed list so later mutation cannot corrupt the error", () => {
    const indices = [0, 1];
    const err = new NoteNotIndexedError({
      message: "m",
      leafIndex: 5,
      indexedLeafIndices: indices,
    });
    indices.push(99);
    expect(err.indexedLeafIndices).toEqual([0, 1]);
  });

  it("keeps instanceof handling working after a message rewrite", () => {
    const before = new PoolRootsStaleError({
      message: "Published roots don't yet cover your deposit.",
      poolId: "C1",
      stateRootMatches: false,
      aspRootMatches: true,
    });
    const after = new PoolRootsStaleError({
      message: "Totally different copy, localised, with emoji ⏳",
      poolId: "C1",
      stateRootMatches: false,
      aspRootMatches: true,
    });
    for (const err of [before, after]) {
      expect(err).toBeInstanceOf(PoolRootsStaleError);
      expect(err).toBeInstanceOf(ProofError);
      expect(err.code).toBe("POOL_ROOTS_STALE");
      expect(hasErrorCode(err, "POOL_ROOTS_STALE")).toBe(true);
    }
  });

  it("groups errors by stage-level base class", () => {
    expect(new ProofGenerationError({ message: "m", circuit: "c" })).toBeInstanceOf(ProofError);
    expect(new SimulationFailedError({ message: "m", contractId: "C", method: "m" })).toBeInstanceOf(
      VerificationError,
    );
    expect(new TransactionTimeoutError({ message: "m", txHash: "h", waitedMs: 1 })).toBeInstanceOf(
      SubmissionError,
    );
    expect(
      new RelayerNoBidsError({ message: "m", jobIdHex: "ff", receivedBids: 0 }),
    ).toBeInstanceOf(RelayerError);
  });

  it("marks indexer-lag failures retryable and user errors not", () => {
    expect(
      isRetryable(
        new PoolRootsUnpublishedError({
          message: "m",
          poolId: "C1",
          hasStateRoot: false,
          hasAspRoot: false,
        }),
      ),
    ).toBe(true);
    expect(
      isRetryable(new NoteCommitmentMismatchError({
        message: "m",
        leafIndex: 1,
        expectedCommitment: "a",
        onChainCommitment: "b",
      })),
    ).toBe(false);
  });

  it("derives gateway retryability from the HTTP status", () => {
    const transient = new RelayerGatewayError({
      message: "m",
      gateway: "http://gw",
      operation: "advert",
      status: 503,
    });
    const permanent = new RelayerGatewayError({
      message: "m",
      gateway: "http://gw",
      operation: "advert",
      status: 400,
    });
    expect(transient.retryable).toBe(true);
    expect(permanent.retryable).toBe(false);
  });
});

describe("cause preservation (#562)", () => {
  it("keeps the underlying error on `cause`", () => {
    const root = new Error("socket hang up");
    const wrapped = new ProofGenerationError({
      message: "proving failed",
      circuit: "withdraw",
      cause: root,
    });
    expect(wrapped.cause).toBe(root);
  });

  it("surfaces the last underlying error from retry exhaustion", () => {
    const last = new Error("503 Service Unavailable");
    const err = new RpcRetriesExhaustedError({
      message: "m",
      cause: last,
      method: "getEvents",
      attempts: 3,
      providersTried: 2,
      elapsedMs: 900,
    });
    expect(err.cause).toBe(last);
    expect(err.lastError).toBe(last);
    expect(err.attempts).toBe(3);
    expect(err.providersTried).toBe(2);
  });

  it("finds a typed error nested in a cause chain", () => {
    const inner = new SimulationFailedError({
      message: "sim",
      contractId: "C1",
      method: "withdraw",
    });
    const outer = new UnknownOpaqueError({ message: "outer", cause: inner });
    expect(findCause(outer, SimulationFailedError)).toBe(inner);
    expect(findCause(outer, ProofGenerationError)).toBeNull();
  });

  it("stops walking a self-referential cause chain", () => {
    const err = new Error("loop") as Error & { cause?: unknown };
    err.cause = err;
    expect(findCause(err, SimulationFailedError)).toBeNull();
  });
});

describe("toOpaqueError (#562)", () => {
  it("passes typed errors through unchanged", () => {
    const typed = new ProofRejectedError({ message: "m", contractId: "C1" });
    expect(toOpaqueError(typed)).toBe(typed);
  });

  it("wraps a plain Error, keeping the original reachable", () => {
    const raw = new Error("boom");
    const wrapped = toOpaqueError(raw);
    expect(wrapped).toBeInstanceOf(UnknownOpaqueError);
    expect(wrapped).toBeInstanceOf(OpaqueError);
    expect(wrapped.cause).toBe(raw);
    expect(wrapped.code).toBe("UNKNOWN");
  });

  it("wraps non-Error throws", () => {
    const wrapped = toOpaqueError("just a string");
    expect(wrapped).toBeInstanceOf(UnknownOpaqueError);
    expect(wrapped.message).toBe("just a string");
  });
});

describe("toJSON (#562)", () => {
  it("emits a serialisable, code-first shape", () => {
    const err = new TransactionFailedError({
      message: "Transaction FAILED",
      txHash: "deadbeef",
      status: "FAILED",
      diagnostics: "ContractError#5",
      cause: new Error("underlying"),
    });
    const json = err.toJSON();
    expect(json.code).toBe("TX_FAILED");
    expect(json.stage).toBe("submission");
    expect(json.name).toBe("TransactionFailedError");
    expect(json.context.txHash).toBe("deadbeef");
    expect(json.causeMessage).toBe("underlying");
    expect(() => JSON.stringify(json)).not.toThrow();
  });

  it("omits causeMessage when there is no cause", () => {
    const json = new ProofRejectedError({ message: "m", contractId: "C1" }).toJSON();
    expect(json.causeMessage).toBeUndefined();
  });
});
