/**
 * React hook wrapping the scanner Web Worker (#606 / #605).
 *
 * Moves trial-decryption (WASM view-tag + full match checks) off the main
 * thread so the UI stays responsive during a full scan, and surfaces a
 * resumable cursor if the worker aborts on memory pressure so the caller can
 * offer the user a "Resume scan" action instead of losing progress.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ScanWorkerAnnouncement,
  ScanWorkerMatch,
  ScanWorkerOutboundMessage,
} from "../workers/scannerWorker";

export type ScannerWorkerStatus = "idle" | "scanning" | "done" | "aborted" | "error";

export interface ScannerWorkerState {
  status: ScannerWorkerStatus;
  processed: number;
  total: number;
  matches: ScanWorkerMatch[];
  /** Set when status === "aborted"; pass to `scan(..., { startIndex: resumeFromIndex })` to continue. */
  resumeFromIndex: number | null;
  error: string | null;
}

export interface ScanRequestOptions {
  startIndex?: number;
  progressIntervalMs?: number;
}

export interface UseScannerWorkerResult extends ScannerWorkerState {
  scan(
    announcements: ScanWorkerAnnouncement[],
    viewPrivKeyHex: string,
    spendPubKeyHex: string,
    options?: ScanRequestOptions,
  ): Promise<ScanWorkerMatch[]>;
  /** Re-run from where the last scan aborted. No-op if there is nothing to resume. */
  resume(
    announcements: ScanWorkerAnnouncement[],
    viewPrivKeyHex: string,
    spendPubKeyHex: string,
  ): Promise<ScanWorkerMatch[]>;
}

const INITIAL_STATE: ScannerWorkerState = {
  status: "idle",
  processed: 0,
  total: 0,
  matches: [],
  resumeFromIndex: null,
  error: null,
};

/**
 * Pure state transition for an incoming worker message. Exported so the
 * progress/done/aborted/error handling can be unit tested without spinning
 * up a real Worker or React renderer.
 */
export function reduceScanWorkerMessage(
  state: ScannerWorkerState,
  msg: ScanWorkerOutboundMessage,
): ScannerWorkerState {
  switch (msg.type) {
    case "progress":
      return { ...state, status: "scanning", processed: msg.processed, total: msg.total };
    case "done":
      return { ...state, status: "done", matches: msg.matches, resumeFromIndex: null, error: null };
    case "aborted":
      return {
        ...state,
        status: "aborted",
        matches: msg.matches,
        resumeFromIndex: msg.resumeFromIndex,
        error: null,
      };
    case "error":
      return { ...state, status: "error", error: msg.message };
  }
}

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `scan-${requestCounter}-${Date.now()}`;
}

export function useScannerWorker(): UseScannerWorkerResult {
  const [state, setState] = useState<ScannerWorkerState>(INITIAL_STATE);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    requestId: string;
    resolve: (matches: ScanWorkerMatch[]) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../workers/scannerWorker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current.addEventListener("message", (event: MessageEvent<ScanWorkerOutboundMessage>) => {
        const msg = event.data;
        const pending = pendingRef.current;
        if (!pending || msg.requestId !== pending.requestId) return;

        setState((s) => reduceScanWorkerMessage(s, msg));

        if (msg.type === "done" || msg.type === "aborted") {
          pendingRef.current = null;
          // Memory-pressure abort is not a failure the caller must catch —
          // it resolves with the partial matches so far, same as `done`,
          // and the UI decides whether to call resume().
          pending.resolve(msg.matches);
        } else if (msg.type === "error") {
          pendingRef.current = null;
          pending.reject(new Error(msg.message));
        }
      });
    }
    return workerRef.current;
  }, []);

  useEffect(() => {
    return () => {
      // Teardown: terminate the worker so its WASM instance and any retained
      // announcement/key buffers are released rather than lingering after
      // the component using this hook unmounts.
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const scan = useCallback(
    (
      announcements: ScanWorkerAnnouncement[],
      viewPrivKeyHex: string,
      spendPubKeyHex: string,
      options?: ScanRequestOptions,
    ): Promise<ScanWorkerMatch[]> => {
      const worker = getWorker();
      const requestId = nextRequestId();
      setState((s) => ({
        ...s,
        status: "scanning",
        processed: 0,
        total: announcements.length,
        error: null,
      }));

      return new Promise<ScanWorkerMatch[]>((resolve, reject) => {
        pendingRef.current = { requestId, resolve, reject };
        worker.postMessage({
          type: "scan",
          requestId,
          announcements,
          viewPrivKeyHex,
          spendPubKeyHex,
          startIndex: options?.startIndex,
          progressIntervalMs: options?.progressIntervalMs,
        });
      });
    },
    [getWorker],
  );

  const resume = useCallback(
    (
      announcements: ScanWorkerAnnouncement[],
      viewPrivKeyHex: string,
      spendPubKeyHex: string,
    ): Promise<ScanWorkerMatch[]> => {
      if (state.resumeFromIndex == null) return Promise.resolve(state.matches);
      return scan(announcements, viewPrivKeyHex, spendPubKeyHex, {
        startIndex: state.resumeFromIndex,
      });
    },
    [scan, state.resumeFromIndex, state.matches],
  );

  return { ...state, scan, resume };
}
