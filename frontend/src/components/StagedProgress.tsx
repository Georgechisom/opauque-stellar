/**
 * Named-stage progress display for multi-second, in-browser operations (#547).
 *
 * A single spinner reads as a hang once an operation runs more than a couple of
 * seconds. This renders each stage distinctly (pending / active / done) and, if a
 * stage runs long, switches its status text to a live elapsed-time count instead of
 * leaving the UI looking frozen.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

export interface StageDef {
  key: string;
  label: string;
}

interface StagedProgressProps {
  stages: StageDef[];
  currentStage: string;
  progress: number;
}

const STALL_THRESHOLD_MS = 2500;

export function StagedProgress({ stages, currentStage, progress }: StagedProgressProps) {
  const reduceMotion = usePrefersReducedMotion();
  const stageStartRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    stageStartRef.current = Date.now();
    setElapsedMs(0);
  }, [currentStage]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - stageStartRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [currentStage]);

  const activeIndex = stages.findIndex((s) => s.key === currentStage);
  const isStalled = elapsedMs >= STALL_THRESHOLD_MS;

  return (
    <div className="space-y-3">
      <ol className="flex items-start justify-between gap-2" aria-label="Proof generation stages">
        {stages.map((s, i) => {
          const state = activeIndex < 0 ? "pending" : i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li key={s.key} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <span
                className={
                  "relative flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold " +
                  (reduceMotion ? "" : "transition-colors ") +
                  (state === "done"
                    ? "border-white/40 bg-white/15 text-white"
                    : state === "active"
                      ? "border-glow bg-glow/15 text-glow"
                      : "border-ink-700 bg-ink-950/40 text-mist/50")
                }
                aria-current={state === "active" ? "step" : undefined}
              >
                {state === "active" && !reduceMotion && (
                  <span
                    className="absolute inset-0 rounded-full border-2 border-glow/30 border-t-glow animate-spin"
                    aria-hidden
                  />
                )}
                <span className="relative">{state === "done" ? "✓" : i + 1}</span>
              </span>
              <span
                className={
                  "text-[11px] " +
                  (state === "active" ? "font-medium text-white" : state === "done" ? "text-mist" : "text-mist/50")
                }
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="h-1.5 max-w-xs mx-auto overflow-hidden rounded-full bg-ink-800">
        <div
          className={"h-full rounded-full bg-linear-to-r from-white to-white " + (reduceMotion ? "" : "transition-all duration-700 ease-out")}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-center text-[11px] text-mist/70" role="status" aria-live="polite">
        {isStalled ? `Still working — ${Math.floor(elapsedMs / 1000)}s elapsed` : `${progress}%`}
      </p>
    </div>
  );
}
