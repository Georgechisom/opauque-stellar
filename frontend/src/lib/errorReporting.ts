/**
 * Opt-in, privacy-preserving error reporting (#560).
 *
 * There is no signal about client-side failures in the field, and a normal crash
 * reporter would betray exactly what this wallet exists to protect. The compromise
 * implemented here:
 *
 *  - **Off by default.** Nothing is built, queued, or sent until the user turns it on.
 *    {@link isReportingEnabled} is the single gate, and {@link sendErrorReport}
 *    re-checks it at send time.
 *  - **Scrubbed at capture, not at send.** {@link buildErrorReport} runs every field
 *    through {@link scrubValue}/{@link scrubText} before the report object exists, so
 *    a raw address is never held in memory as "a pending report".
 *  - **Inspectable.** {@link previewErrorReport} returns the exact JSON string that
 *    {@link sendErrorReport} transmits — the UI shows that string verbatim, so
 *    "what will be sent" is not a description of the payload, it *is* the payload.
 *  - **Explicit send.** Reports queue locally and are transmitted only when the user
 *    presses send; discarding drops them.
 */

import { isOpaqueError, toOpaqueError, type OpaqueErrorCode } from "./errors";
import {
  coarsenTimestamp,
  scrubStack,
  scrubText,
  scrubUserAgent,
  scrubValue,
} from "./errorScrubber";

/** localStorage key holding the opt-in flag. Absent/anything-but-"1" means off. */
export const REPORTING_CONSENT_KEY = "opaque.error-reporting.consent.v1";

/** Report schema version, bumped when fields change shape. */
export const REPORT_SCHEMA_VERSION = 1;

export type ErrorReport = {
  schemaVersion: number;
  /** Random per-report id. Not derived from anything user-linked. */
  id: string;
  /** Capture time, rounded down to the hour (see `coarsenTimestamp`). */
  capturedAtHour: number;
  /** Typed error code (#562), or "UNKNOWN" for an untyped throw. */
  code: OpaqueErrorCode;
  /** Pipeline stage the failure came from. */
  stage: string;
  /** Error class name. */
  name: string;
  /** Scrubbed message. */
  message: string;
  /** Scrubbed structured context from the typed error. */
  context: Record<string, unknown>;
  /** Scrubbed stack frames (paths reduced to `file:line:col`). */
  stack: string[];
  /** Scrubbed message of the underlying cause, when there was one. */
  causeMessage?: string;
  /** Coarse environment. */
  environment: {
    network: string;
    appVersion: string;
    userAgent: string;
  };
};

export type ReportEnvironment = {
  network: string;
  appVersion: string;
  userAgent?: string;
};

// ─── Consent ────────────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // private mode / blocked storage
  }
}

/** Reporting is off unless the user has explicitly opted in. */
export function isReportingEnabled(): boolean {
  return safeStorage()?.getItem(REPORTING_CONSENT_KEY) === "1";
}

/** Record the user's choice. Turning it off also clears the pending queue. */
export function setReportingEnabled(enabled: boolean): void {
  const storage = safeStorage();
  if (!storage) return;
  if (enabled) {
    storage.setItem(REPORTING_CONSENT_KEY, "1");
  } else {
    storage.removeItem(REPORTING_CONSENT_KEY);
    clearPendingReports();
  }
}

// ─── Building ───────────────────────────────────────────────────────────────

function randomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a fully-scrubbed report from any thrown value.
 *
 * Pure and side-effect free — it neither checks consent nor queues anything, so the
 * preview UI can build a sample report even while reporting is disabled.
 */
export function buildErrorReport(
  error: unknown,
  environment: ReportEnvironment,
  now: number = Date.now(),
): ErrorReport {
  const typed = toOpaqueError(error);
  const cause = typed.cause;
  const causeMessage =
    cause instanceof Error
      ? scrubText(cause.message)
      : cause !== undefined
        ? scrubText(String(cause))
        : undefined;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    id: randomId(),
    capturedAtHour: coarsenTimestamp(now),
    code: typed.code,
    stage: typed.stage,
    name: typed.name,
    message: scrubText(typed.message),
    context: scrubValue(
      isOpaqueError(error) ? { ...error.context } : {},
    ) as Record<string, unknown>,
    stack: scrubStack(typed.stack),
    ...(causeMessage !== undefined ? { causeMessage } : {}),
    environment: {
      network: environment.network,
      appVersion: environment.appVersion,
      userAgent: scrubUserAgent(
        environment.userAgent ??
          (typeof navigator === "undefined" ? undefined : navigator.userAgent),
      ),
    },
  };
}

/**
 * The exact bytes {@link sendErrorReport} will transmit.
 *
 * The UI renders this string verbatim so the user reviews the payload itself rather
 * than a summary of it.
 */
export function previewErrorReport(report: ErrorReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── Pending queue ──────────────────────────────────────────────────────────

const pending: ErrorReport[] = [];
const MAX_PENDING = 20;
type Listener = (reports: readonly ErrorReport[]) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener([...pending]);
}

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function subscribeToPendingReports(listener: Listener): () => void {
  listeners.add(listener);
  listener([...pending]);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingReports(): readonly ErrorReport[] {
  return [...pending];
}

export function clearPendingReports(): void {
  pending.length = 0;
  notify();
}

export function discardReport(id: string): void {
  const index = pending.findIndex((r) => r.id === id);
  if (index >= 0) {
    pending.splice(index, 1);
    notify();
  }
}

/**
 * Queue a failure for review. A no-op while reporting is disabled — the error is not
 * captured, not scrubbed, and not stored.
 *
 * Nothing leaves the device here; the user still has to press send.
 */
export function captureError(
  error: unknown,
  environment: ReportEnvironment,
): ErrorReport | null {
  if (!isReportingEnabled()) return null;
  const report = buildErrorReport(error, environment);
  pending.push(report);
  if (pending.length > MAX_PENDING) pending.shift();
  notify();
  return report;
}

/**
 * Route uncaught errors and unhandled rejections through {@link captureError}.
 *
 * Safe to call unconditionally at boot: while reporting is disabled the handlers run
 * but `captureError` returns immediately without touching the error. Returns a
 * teardown function.
 */
export function installGlobalErrorCapture(
  environment: ReportEnvironment,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => {
    captureError(event.error ?? event.message, environment);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    captureError(event.reason, environment);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

// ─── Transmission ───────────────────────────────────────────────────────────

/** Collector endpoint. Reporting is unavailable when this is unset. */
export function reportingEndpoint(): string | null {
  const raw = (
    import.meta.env.VITE_ERROR_REPORT_ENDPOINT as string | undefined
  )?.trim();
  return raw ? raw : null;
}

export function isReportingAvailable(): boolean {
  return reportingEndpoint() !== null;
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "disabled" | "unconfigured" | "network"; detail?: string };

/**
 * Transmit one report. Consent is re-checked here rather than trusted from the call
 * site, so a stale UI state can never cause an unconsented send.
 */
export async function sendErrorReport(report: ErrorReport): Promise<SendResult> {
  if (!isReportingEnabled()) return { ok: false, reason: "disabled" };
  const endpoint = reportingEndpoint();
  if (!endpoint) return { ok: false, reason: "unconfigured" };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Same string the user reviewed in the preview.
      body: previewErrorReport(report),
      // No cookies, no credentials: the report must not carry an identity.
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) {
      return { ok: false, reason: "network", detail: `HTTP ${res.status}` };
    }
    discardReport(report.id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
