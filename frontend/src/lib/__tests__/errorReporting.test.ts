/**
 * Opt-in error reporting tests (#560).
 *
 * Covers the three properties the issue calls for: reporting is off until the user
 * opts in, the payload is scrubbed against fixtures containing secrets, and what the
 * user previews is byte-for-byte what gets sent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NoteNotIndexedError,
  ProofGenerationError,
  TransactionFailedError,
} from "../errors";
import {
  REPORTING_CONSENT_KEY,
  buildDiagnosticsExport,
  buildErrorReport,
  captureError,
  clearPendingReports,
  discardReport,
  getPendingReports,
  isReportingAvailable,
  isReportingEnabled,
  previewErrorReport,
  reportingEndpoint,
  sendErrorReport,
  setReportingEnabled,
  subscribeToPendingReports,
} from "../errorReporting";

const ACCOUNT = "GA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM";
const CONTRACT = "CA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM";
const NULLIFIER_HEX = "3f9a1c2b8e7d6054aa11bb22cc33dd44ee55ff66007788990011223344556677";

const ENV = { network: "testnet", appVersion: "1.4.2", userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0" };

/** Minimal in-memory localStorage; the module treats an absent one as "opted out". */
function installStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

/** An error carrying every kind of secret the wallet handles. */
function secretBearingError(): ProofGenerationError {
  return new ProofGenerationError({
    message: `Proving failed for ${ACCOUNT} withdrawing 12.5 XLM (nullifier 0x${NULLIFIER_HEX})`,
    circuit: "privacy_pool_withdraw",
    cause: new Error(`pool ${CONTRACT} returned 125000000 stroops`),
    context: {
      poolId: CONTRACT,
      recipient: ACCOUNT,
      nullifier: `0x${NULLIFIER_HEX}`,
      amountStroops: 125_000_000n,
      leafIndex: 12,
    },
  });
}

beforeEach(() => {
  installStorage();
  clearPendingReports();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("consent gate (#560)", () => {
  it("is off by default", () => {
    expect(isReportingEnabled()).toBe(false);
  });

  it("stays off when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(isReportingEnabled()).toBe(false);
    expect(() => setReportingEnabled(true)).not.toThrow();
  });

  it("captures nothing while disabled", () => {
    expect(captureError(secretBearingError(), ENV)).toBeNull();
    expect(getPendingReports()).toHaveLength(0);
  });

  it("captures only after an explicit opt-in", () => {
    setReportingEnabled(true);
    expect(isReportingEnabled()).toBe(true);
    expect(captureError(secretBearingError(), ENV)).not.toBeNull();
    expect(getPendingReports()).toHaveLength(1);
  });

  it("clears the queue when consent is withdrawn", () => {
    setReportingEnabled(true);
    captureError(secretBearingError(), ENV);
    expect(getPendingReports()).toHaveLength(1);

    setReportingEnabled(false);
    expect(isReportingEnabled()).toBe(false);
    expect(getPendingReports()).toHaveLength(0);
    expect(localStorage.getItem(REPORTING_CONSENT_KEY)).toBeNull();
  });

  it("refuses to send while disabled, even with a report in hand", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "https://collector.example/report");

    const report = buildErrorReport(secretBearingError(), ENV);
    await expect(sendErrorReport(report)).resolves.toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sanitized diagnostics export (#142)", () => {
  it("includes app metadata without leaking keys or addresses", () => {
    const exportPayload = buildDiagnosticsExport({
      appVersion: ENV.appVersion,
      network: ENV.network,
      featureFlags: { manualGhostAddresses: true, privacyPool: false, debugLogs: true },
      contractIds: { privacyPool: CONTRACT, schemaRegistry: "CA58..." },
      syncStatus: { scanner: "ready", lastLedger: 12345, lastUpdatedAt: "2026-08-25T10:00:00Z" },
      errors: [
        buildErrorReport(
          new ProofGenerationError({
            message: `Proving failed for ${ACCOUNT} withdrawing 12.5 XLM`,
            circuit: "privacy_pool_withdraw",
            context: { poolId: CONTRACT, amountStroops: 125_000_000n },
          }),
          ENV,
        ),
      ],
    });

    const serialized = JSON.stringify(exportPayload);
    expect(exportPayload.appVersion).toBe("1.4.2");
    expect(exportPayload.network).toBe("testnet");
    expect(exportPayload.featureFlags.privacyPool).toBe(false);
    expect(exportPayload.contractIds.privacyPool).toBe(CONTRACT);
    expect(serialized).not.toContain(ACCOUNT);
    expect(serialized).not.toContain(CONTRACT);
    expect(serialized).not.toContain("12.5");
    expect(serialized).toContain("privacy_pool_withdraw");
  });
});

describe("report scrubbing against a secret-bearing fixture (#560)", () => {
  it("leaks no address, amount, or note material anywhere in the payload", () => {
    const serialized = previewErrorReport(buildErrorReport(secretBearingError(), ENV));
    for (const secret of [ACCOUNT, CONTRACT, NULLIFIER_HEX, "125000000", "12.5"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps the fields that make a report actionable", () => {
    const report = buildErrorReport(secretBearingError(), ENV);
    expect(report.code).toBe("PROOF_GENERATION_FAILED");
    expect(report.stage).toBe("proof");
    expect(report.name).toBe("ProofGenerationError");
    expect(report.environment.network).toBe("testnet");
    expect(report.environment.appVersion).toBe("1.4.2");
    expect(report.context.leafIndex).toBe(12);
  });

  it("coarsens the user agent and the capture time", () => {
    const capturedAt = Date.UTC(2026, 6, 26, 14, 37, 51);
    const report = buildErrorReport(secretBearingError(), ENV, capturedAt);
    expect(report.environment.userAgent).toBe("Chrome on Linux");
    expect(report.capturedAtHour).toBe(Date.UTC(2026, 6, 26, 14, 0, 0));
  });

  it("scrubs the underlying cause message too", () => {
    const report = buildErrorReport(secretBearingError(), ENV);
    expect(report.causeMessage).toBeDefined();
    expect(report.causeMessage).not.toContain(CONTRACT);
    expect(report.causeMessage).not.toContain("125000000");
  });

  it("scrubs stack frames", () => {
    const err = new TransactionFailedError({
      message: "Transaction FAILED",
      txHash: "deadbeefdeadbeefdeadbeef",
      status: "FAILED",
    });
    err.stack = `TransactionFailedError: boom\n    at submit (/home/alice/opaque/frontend/src/lib/stellar.ts:301:13)`;
    const report = buildErrorReport(err, ENV);
    expect(report.stack.join("\n")).not.toContain("/home/alice");
    expect(report.stack.join("\n")).toContain("stellar.ts:301:13");
  });

  it("normalises an untyped throw into a reportable shape", () => {
    const report = buildErrorReport(`crash near ${ACCOUNT}`, ENV);
    expect(report.code).toBe("UNKNOWN");
    expect(report.message).not.toContain(ACCOUNT);
  });

  it("reports structured error fields without their secret values", () => {
    const report = buildErrorReport(
      new NoteNotIndexedError({
        message: "not indexed",
        leafIndex: 4,
        indexedLeafIndices: [0, 1, 2],
      }),
      ENV,
    );
    expect(report.context.leafIndex).toBe(4);
    expect(report.context.indexedCount).toBe(3);
  });
});

describe("inspect-before-send (#560)", () => {
  it("sends exactly the bytes the preview showed", async () => {
    setReportingEnabled(true);
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "https://collector.example/report");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const report = buildErrorReport(secretBearingError(), ENV);
    const previewed = previewErrorReport(report);

    await expect(sendErrorReport(report)).resolves.toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(previewed);
    expect(init.credentials).toBe("omit");
  });

  it("produces a preview that is valid, readable JSON", () => {
    const report = buildErrorReport(secretBearingError(), ENV);
    const previewed = previewErrorReport(report);
    expect(previewed).toContain("\n  ");
    expect(JSON.parse(previewed).code).toBe("PROOF_GENERATION_FAILED");
  });
});

describe("queue management (#560)", () => {
  beforeEach(() => setReportingEnabled(true));

  it("notifies subscribers on capture and discard", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToPendingReports((reports) => seen.push(reports.length));

    const report = captureError(secretBearingError(), ENV);
    discardReport(report!.id);
    unsubscribe();
    captureError(secretBearingError(), ENV);

    expect(seen).toEqual([0, 1, 0]);
  });

  it("drops a sent report from the queue", async () => {
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "https://collector.example/report");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const report = captureError(secretBearingError(), ENV)!;
    await sendErrorReport(report);
    expect(getPendingReports()).toHaveLength(0);
  });

  it("keeps a report queued when the collector rejects it", async () => {
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "https://collector.example/report");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const report = captureError(secretBearingError(), ENV)!;
    const result = await sendErrorReport(report);
    expect(result).toEqual({ ok: false, reason: "network", detail: "HTTP 500" });
    expect(getPendingReports()).toHaveLength(1);
  });

  it("survives a network throw", async () => {
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "https://collector.example/report");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const report = captureError(secretBearingError(), ENV)!;
    const result = await sendErrorReport(report);
    expect(result.ok).toBe(false);
    expect(getPendingReports()).toHaveLength(1);
  });

  it("bounds the queue", () => {
    for (let i = 0; i < 30; i += 1) captureError(secretBearingError(), ENV);
    expect(getPendingReports().length).toBeLessThanOrEqual(20);
  });

  it("gives every report a distinct id", () => {
    captureError(secretBearingError(), ENV);
    captureError(secretBearingError(), ENV);
    const [a, b] = getPendingReports();
    expect(a.id).not.toBe(b.id);
  });
});

describe("collector configuration (#560)", () => {
  it("treats reporting as unavailable without an endpoint", () => {
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "");
    expect(reportingEndpoint()).toBeNull();
    expect(isReportingAvailable()).toBe(false);
  });

  it("reports `unconfigured` rather than dropping the report silently", async () => {
    setReportingEnabled(true);
    vi.stubEnv("VITE_ERROR_REPORT_ENDPOINT", "");
    const report = buildErrorReport(secretBearingError(), ENV);
    await expect(sendErrorReport(report)).resolves.toEqual({
      ok: false,
      reason: "unconfigured",
    });
  });
});
