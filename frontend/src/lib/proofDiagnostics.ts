/**
 * In-session diagnostics log for in-browser proof generation (#547).
 *
 * Stage timings are intentionally not shown in the proof modal itself — only
 * surfaced via `subscribeToProofRuns` for a dedicated diagnostics view — so the
 * generation UI stays focused on the current stage rather than raw numbers.
 * Nothing here is persisted; it resets on reload.
 */

export interface ProofStageTiming {
  stage: string;
  durationMs: number;
}

export interface ProofRunLog {
  id: string;
  label: string;
  stages: ProofStageTiming[];
  totalMs: number;
  completedAt: number;
  outcome: "success" | "error";
}

const MAX_RUNS = 10;

let runs: ProofRunLog[] = [];
const listeners = new Set<(runs: readonly ProofRunLog[]) => void>();

function notify(): void {
  for (const listener of listeners) listener(runs);
}

function recordProofRun(log: ProofRunLog): void {
  runs = [log, ...runs].slice(0, MAX_RUNS);
  notify();
}

export function getProofRuns(): readonly ProofRunLog[] {
  return runs;
}

export function subscribeToProofRuns(
  callback: (runs: readonly ProofRunLog[]) => void,
): () => void {
  listeners.add(callback);
  callback(runs);
  return () => {
    listeners.delete(callback);
  };
}

/** Tracks per-stage wall-clock time for a single proof-generation attempt. */
export class ProofStageTimer {
  private readonly label: string;
  private readonly runStartedAt: number;
  private readonly stages: ProofStageTiming[] = [];
  private currentStage: string | null = null;
  private stageStartedAt: number | null = null;

  constructor(label: string) {
    this.label = label;
    this.runStartedAt = performance.now();
  }

  /** Call on every progress update; no-ops if still within the same stage. */
  enter(stage: string): void {
    if (stage === this.currentStage) return;
    this.closeCurrentStage();
    this.currentStage = stage;
    this.stageStartedAt = performance.now();
  }

  private closeCurrentStage(): void {
    if (this.currentStage !== null && this.stageStartedAt !== null) {
      this.stages.push({
        stage: this.currentStage,
        durationMs: performance.now() - this.stageStartedAt,
      });
    }
  }

  /** Finalizes the run and records it to the diagnostics log. */
  finish(outcome: "success" | "error"): void {
    this.closeCurrentStage();
    this.currentStage = null;
    this.stageStartedAt = null;
    recordProofRun({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: this.label,
      stages: this.stages,
      totalMs: performance.now() - this.runStartedAt,
      completedAt: Date.now(),
      outcome,
    });
  }
}
