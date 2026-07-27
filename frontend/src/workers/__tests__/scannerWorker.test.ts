/**
 * Scanner worker: memory-pressure abort + resumable cursor (#605),
 * and off-main-thread scan progress/matching (#606).
 */
import { describe, it, expect, vi } from "vitest";
import {
  readHeapUsageRatio,
  shouldAbortForMemoryPressure,
  hexToBytes,
  runScan,
  MEMORY_PRESSURE_RATIO,
  MEMORY_CHECK_INTERVAL,
  type ScanWorkerRequest,
  type ScanWorkerOutboundMessage,
  type ScanWorkerAnnouncement,
} from "../scannerWorker";

describe("readHeapUsageRatio (#605)", () => {
  it("returns null when performance.memory is unavailable (Firefox/Safari)", () => {
    expect(readHeapUsageRatio({} as Performance)).toBeNull();
  });

  it("computes usedJSHeapSize / jsHeapSizeLimit when available (Chrome)", () => {
    const perf = {
      memory: { usedJSHeapSize: 900, jsHeapSizeLimit: 1000 },
    } as unknown as Performance;
    expect(readHeapUsageRatio(perf)).toBeCloseTo(0.9);
  });

  it("returns null when jsHeapSizeLimit is zero (avoid divide-by-zero)", () => {
    const perf = { memory: { usedJSHeapSize: 0, jsHeapSizeLimit: 0 } } as unknown as Performance;
    expect(readHeapUsageRatio(perf)).toBeNull();
  });
});

describe("shouldAbortForMemoryPressure (#605)", () => {
  it("aborts when heap ratio is at or above the pressure threshold", () => {
    expect(shouldAbortForMemoryPressure(100, MEMORY_PRESSURE_RATIO)).toBe(true);
    expect(shouldAbortForMemoryPressure(100, 0.95)).toBe(true);
  });

  it("does not abort when heap ratio is comfortably below threshold", () => {
    expect(shouldAbortForMemoryPressure(100, 0.5)).toBe(false);
  });

  it("falls back to a hard processed-count cap when no heap ratio is available", () => {
    expect(shouldAbortForMemoryPressure(1_999_999, null)).toBe(false);
    expect(shouldAbortForMemoryPressure(2_000_000, null)).toBe(true);
  });

  it("respects a custom fallback cap", () => {
    expect(shouldAbortForMemoryPressure(50, null, 100)).toBe(false);
    expect(shouldAbortForMemoryPressure(100, null, 100)).toBe(true);
  });
});

describe("hexToBytes", () => {
  it("decodes with and without 0x prefix identically", () => {
    expect(hexToBytes("0xdeadbeef")).toEqual(hexToBytes("deadbeef"));
    expect(Array.from(hexToBytes("deadbeef"))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

function makeAnnouncement(index: number, matches: boolean): ScanWorkerAnnouncement {
  return {
    index,
    id: `ann-${index}`,
    stealthAddress: matches ? "0xmatch" : "0xnomatch",
    viewTag: index % 256,
    ephemeralPubKeyHex: "0x" + "ab".repeat(33),
  };
}

function fakeWasm(matchAddress = "0xmatch") {
  return {
    check_announcement_view_tag_wasm: vi.fn().mockReturnValue("PossibleMatch"),
    check_announcement_wasm: vi.fn((addr: string) => addr === matchAddress),
  };
}

describe("runScan (#606 off-main-thread scan / #605 memory abort)", () => {
  it("posts a done message with only the matching announcements", async () => {
    const req: ScanWorkerRequest = {
      type: "scan",
      requestId: "r1",
      announcements: [makeAnnouncement(0, false), makeAnnouncement(1, true), makeAnnouncement(2, false)],
      viewPrivKeyHex: "aa".repeat(32),
      spendPubKeyHex: "bb".repeat(33),
    };

    const posted: ScanWorkerOutboundMessage[] = [];
    await runScan(req, fakeWasm(), (msg) => posted.push(msg));

    const done = posted.find((m) => m.type === "done");
    expect(done).toBeDefined();
    expect(done && "matches" in done ? done.matches : []).toEqual([
      { index: 1, id: "ann-1", stealthAddress: "0xmatch" },
    ]);
  });

  it("resumes from startIndex, skipping already-processed announcements", async () => {
    const req: ScanWorkerRequest = {
      type: "scan",
      requestId: "r2",
      announcements: [makeAnnouncement(0, true), makeAnnouncement(1, true), makeAnnouncement(2, true)],
      viewPrivKeyHex: "aa".repeat(32),
      spendPubKeyHex: "bb".repeat(33),
      startIndex: 2,
    };

    const posted: ScanWorkerOutboundMessage[] = [];
    await runScan(req, fakeWasm(), (msg) => posted.push(msg));

    const done = posted.find((m) => m.type === "done");
    expect(done && "matches" in done ? done.matches.map((m) => m.index) : []).toEqual([2]);
  });

  it("aborts with a resumable cursor when memory pressure crosses the threshold", async () => {
    const announcements = Array.from({ length: MEMORY_CHECK_INTERVAL * 2 }, (_, i) =>
      makeAnnouncement(i, false),
    );
    const req: ScanWorkerRequest = {
      type: "scan",
      requestId: "r3",
      announcements,
      viewPrivKeyHex: "aa".repeat(32),
      spendPubKeyHex: "bb".repeat(33),
    };

    // Simulate Chrome's performance.memory reporting pressure right at the
    // first MEMORY_CHECK_INTERVAL boundary.
    const originalPerformance = globalThis.performance;
    globalThis.performance = {
      ...originalPerformance,
      memory: { usedJSHeapSize: 950, jsHeapSizeLimit: 1000 },
    } as Performance & { memory: { usedJSHeapSize: number; jsHeapSizeLimit: number } };

    try {
      const posted: ScanWorkerOutboundMessage[] = [];
      await runScan(req, fakeWasm(), (msg) => posted.push(msg));

      const aborted = posted.find((m) => m.type === "aborted");
      expect(aborted).toBeDefined();
      if (aborted && aborted.type === "aborted") {
        expect(aborted.reason).toBe("memory-pressure");
        expect(aborted.resumeFromIndex).toBe(MEMORY_CHECK_INTERVAL);
      }
      expect(posted.some((m) => m.type === "done")).toBe(false);
    } finally {
      globalThis.performance = originalPerformance;
    }
  });

  it("skips malformed rows (bad ephemeral key length) without aborting the scan", async () => {
    const bad: ScanWorkerAnnouncement = {
      index: 0,
      id: "bad",
      stealthAddress: "0xmatch",
      viewTag: 1,
      ephemeralPubKeyHex: "0xabcd", // too short
    };
    const req: ScanWorkerRequest = {
      type: "scan",
      requestId: "r4",
      announcements: [bad, makeAnnouncement(1, true)],
      viewPrivKeyHex: "aa".repeat(32),
      spendPubKeyHex: "bb".repeat(33),
    };

    const posted: ScanWorkerOutboundMessage[] = [];
    await runScan(req, fakeWasm(), (msg) => posted.push(msg));

    const done = posted.find((m) => m.type === "done");
    expect(done && "matches" in done ? done.matches.map((m) => m.index) : []).toEqual([1]);
  });

  it("reports progress at a bounded frequency, not once per item", async () => {
    const announcements = Array.from({ length: 50 }, (_, i) => makeAnnouncement(i, false));
    const req: ScanWorkerRequest = {
      type: "scan",
      requestId: "r5",
      announcements,
      viewPrivKeyHex: "aa".repeat(32),
      spendPubKeyHex: "bb".repeat(33),
      progressIntervalMs: 100_000, // effectively "never" within this fast synchronous test
    };

    const posted: ScanWorkerOutboundMessage[] = [];
    await runScan(req, fakeWasm(), (msg) => posted.push(msg));

    const progressMessages = posted.filter((m) => m.type === "progress");
    // With a huge interval, at most the loop's very first tick could sneak
    // one through before the clock check engages, but it must not be 50.
    expect(progressMessages.length).toBeLessThan(announcements.length);
  });
});
