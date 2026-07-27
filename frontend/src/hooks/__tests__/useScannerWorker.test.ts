/**
 * Pure state-transition tests for useScannerWorker (#606 / #605). Covers the
 * progress/done/aborted/error reducer without needing a real Worker or a
 * React renderer.
 */
import { describe, it, expect } from "vitest";
import { reduceScanWorkerMessage, type ScannerWorkerState } from "../useScannerWorker";
import type { ScanWorkerOutboundMessage } from "../../workers/scannerWorker";

const initial: ScannerWorkerState = {
  status: "idle",
  processed: 0,
  total: 0,
  matches: [],
  resumeFromIndex: null,
  error: null,
};

describe("reduceScanWorkerMessage", () => {
  it("progress: moves to scanning and updates processed/total", () => {
    const next = reduceScanWorkerMessage(initial, {
      type: "progress",
      requestId: "r1",
      processed: 10,
      total: 100,
    });
    expect(next.status).toBe("scanning");
    expect(next.processed).toBe(10);
    expect(next.total).toBe(100);
  });

  it("done: moves to done, stores matches, clears resumeFromIndex/error", () => {
    const withStalePrevAbort: ScannerWorkerState = {
      ...initial,
      status: "aborted",
      resumeFromIndex: 42,
      error: null,
    };
    const next = reduceScanWorkerMessage(withStalePrevAbort, {
      type: "done",
      requestId: "r1",
      matches: [{ index: 1, id: "a", stealthAddress: "0xabc" }],
    });
    expect(next.status).toBe("done");
    expect(next.matches).toEqual([{ index: 1, id: "a", stealthAddress: "0xabc" }]);
    expect(next.resumeFromIndex).toBeNull();
  });

  it("aborted: moves to aborted, keeps partial matches and resume cursor", () => {
    const next = reduceScanWorkerMessage(initial, {
      type: "aborted",
      requestId: "r1",
      reason: "memory-pressure",
      resumeFromIndex: 500,
      matches: [{ index: 3, id: "c", stealthAddress: "0xdef" }],
    });
    expect(next.status).toBe("aborted");
    expect(next.resumeFromIndex).toBe(500);
    expect(next.matches).toEqual([{ index: 3, id: "c", stealthAddress: "0xdef" }]);
  });

  it("error: moves to error and stores the message", () => {
    const next = reduceScanWorkerMessage(initial, {
      type: "error",
      requestId: "r1",
      message: "boom",
    });
    expect(next.status).toBe("error");
    expect(next.error).toBe("boom");
  });

  it("is a pure function: never mutates the input state", () => {
    const before = JSON.stringify(initial);
    reduceScanWorkerMessage(initial, {
      type: "progress",
      requestId: "r1",
      processed: 1,
      total: 2,
    } satisfies ScanWorkerOutboundMessage);
    expect(JSON.stringify(initial)).toBe(before);
  });
});
