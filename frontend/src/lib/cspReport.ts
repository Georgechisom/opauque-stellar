/**
 * CSP violation report collector.
 *
 * The backend headers (vercel.json / _headers) set Content-Security-Policy-Report-Only
 * with `report-uri /csp-report` and `report-to csp-endpoint`. Browsers send JSON
 * violation reports to that endpoint.
 *
 * This module provides two things:
 *
 * 1. **Client-side listener** — captures CSP violations in the browser console
 *    during development and optionally forwards them to a configurable collector.
 *
 * 2. **Report server** — a minimal standalone script (`scripts/csp-report-server.ts`)
 *    that accepts POST /csp-report and logs violations. Useful during the report-only
 *    observation period before enforcement.
 *
 * ### Enforcing CSP
 *
 * After collecting reports for at least one release cycle with zero critical
 * violations, switch the header from `Content-Security-Policy-Report-Only` to
 * `Content-Security-Policy` and remove the `report-uri` / `report-to` directives.
 */

const REPORT_COLLECTOR_URL = import.meta.env.VITE_CSP_REPORT_URL as
  | string
  | undefined;

export interface CspViolation {
  /** The directive that was violated. */
  violatedDirective: string;
  /** The blocked URI. */
  blockedUri: string;
  /** The original policy string. */
  originalPolicy: string;
  /** Document URI where the violation occurred. */
  documentUri: string;
  /** Source file, if available. */
  sourceFile?: string;
  /** Line number, if available. */
  lineNumber?: number;
  /** Column number, if available. */
  columnNumber?: number;
  /** HTTP status code of the document (usually 200). */
  statusCode: number;
  /** Whether the report was sent via the Reporting API. */
  disposition: "enforce" | "report";
}

/**
 * Register a client-side CSP violation listener.
 *
 * - Logs all violations to the browser console (useful in development).
 * - If VITE_CSP_REPORT_URL is set, POSTs each violation to that endpoint.
 *
 * Call once at app startup (e.g. in main.tsx).
 */
export function initCspReportCollector(): void {
  if (typeof document === "undefined") return;

  document.addEventListener("securitypolicyviolation", (e) => {
    const report: CspViolation = {
      violatedDirective: e.violatedDirective,
      blockedUri: e.blockedURI,
      originalPolicy: e.originalPolicy,
      documentUri: e.documentURI,
      sourceFile: e.sourceFile ?? undefined,
      lineNumber: e.lineNumber ?? undefined,
      columnNumber: e.columnNumber ?? undefined,
      statusCode: e.statusCode,
      disposition: e.disposition,
    };

    // Always log in development
    if (import.meta.env.DEV) {
      console.warn(
        "[CSP] Violation:",
        report.violatedDirective,
        "—",
        report.blockedUri,
        report,
      );
    }

    // Forward to collector if configured
    if (REPORT_COLLECTOR_URL) {
      sendToCollector(report).catch(() => {
        // Silently fail — CSP reports are best-effort
      });
    }
  });
}

async function sendToCollector(report: CspViolation): Promise<void> {
  try {
    await fetch(REPORT_COLLECTOR_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      // Use keepalive so the report survives page navigation
      keepalive: true,
    });
  } catch {
    // Network error — don't disrupt the user
  }
}
