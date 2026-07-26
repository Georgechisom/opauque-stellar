/**
 * Diagnostics-only view of proof-generation stage timings (#547).
 *
 * Deliberately not shown in the proof modal itself — only here — so the
 * generation UI stays focused on the current stage rather than raw numbers.
 */

import { useEffect, useState } from "react";
import { subscribeToProofRuns, type ProofRunLog } from "../lib/proofDiagnostics";

const STAGE_LABELS: Record<string, string> = {
  "preparing-witness": "Witness build",
  "generating-proof": "Proving",
  "verifying-proof": "Verification",
  submitting: "Submitting",
};

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function ProofDiagnosticsPanel() {
  const [runs, setRuns] = useState<readonly ProofRunLog[]>([]);

  useEffect(() => subscribeToProofRuns(setRuns), []);

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
      <h3 className="text-lg font-semibold text-white">Proof stage timings</h3>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-mist/70">
        Per-stage timing for in-browser proof generation attempts made this
        session. Not persisted, not sent anywhere.
      </p>

      {runs.length === 0 ? (
        <p className="mt-4 text-xs text-mist/50">
          No proof generation attempts recorded yet in this session.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="rounded-xl border border-ink-700 bg-ink-950/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-sm text-white">{run.label}</span>
                <span
                  className={
                    "font-mono text-[11px] " +
                    (run.outcome === "success" ? "text-neutral-300" : "text-neutral-400")
                  }
                >
                  {run.outcome === "success" ? "ok" : "error"} · {formatMs(run.totalMs)}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                {run.stages.map((s, i) => (
                  <div key={`${s.stage}-${i}`} className="min-w-0">
                    <dt className="truncate text-[10px] text-mist/60">
                      {STAGE_LABELS[s.stage] ?? s.stage}
                    </dt>
                    <dd className="font-mono text-[11px] text-mist">{formatMs(s.durationMs)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
