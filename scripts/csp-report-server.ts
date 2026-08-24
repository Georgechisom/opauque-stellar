/**
 * Minimal CSP violation report server.
 *
 * Usage:
 *   npx tsx scripts/csp-report-server.ts          # default port 3099
 *   PORT=8080 npx tsx scripts/csp-report-server.ts
 *
 * Accepts POST requests at /csp-report (Content-Security-Policy-Report-Only
 * format) and logs violations to stdout. Intended for local development and
 * the report-only observation period before CSP enforcement.
 *
 * For production, point the CSP `report-uri` at a hosted collector
 * (e.g. report-uri.com, Sentry, or a custom logging endpoint) and set
 * VITE_CSP_REPORT_URL in the frontend env.
 *
 * Related: frontend/src/lib/cspReport.ts
 */

import http from "node:http";

const PORT = Number(process.env.PORT) || 3099;

interface CspReport {
  "csp-report": {
    "document-uri": string;
    "referrer": string;
    "blocked-uri": string;
    "violated-directive": string;
    "effective-directive": string;
    "original-policy": string;
    "disposition": string;
    "status-code": number;
    "script-sample": string;
    "source-file": string;
    "line-number": number;
    "column-number": number;
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/csp-report") {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const report = JSON.parse(body) as CspReport;
        const r = report["csp-report"];
        if (r) {
          const ts = new Date().toISOString();
          console.log(
            `[${ts}] CSP violation: ${r["violated-directive"]} — ${r["blocked-uri"]}`,
          );
          if (r["source-file"]) {
            console.log(
              `  source: ${r["source-file"]}:${r["line-number"]}:${r["column-number"]}`,
            );
          }
          if (r["script-sample"]) {
            console.log(`  sample: ${r["script-sample"]}`);
          }
        }
      } catch {
        console.warn("[csp-report-server] Could not parse report body");
      }
      res.writeHead(204);
      res.end();
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[csp-report-server] Listening on http://localhost:${PORT}/csp-report`);
  console.log(
    "[csp-report-server] Set report-uri to this endpoint during the CSP report-only phase.",
  );
});
