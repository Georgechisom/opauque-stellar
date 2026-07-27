/**
 * Shared clipboard-copy hook (#557).
 *
 * Secret-classified copies (proofs, nullifiers, keys, notes) auto-clear the
 * clipboard after a countdown so they don't sit there indefinitely, exposed
 * to any later paste. Non-secret copies (addresses, links) just show a brief
 * "Copied!" confirmation, matching the existing behavior across the app.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_SECRET_CLEAR_SECONDS = 30;
const DEFAULT_COPIED_FLASH_MS = 2000;

export type CopyStatus = "idle" | "copied" | "unsupported";

export function isClipboardSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
}

export function useCopyToClipboard(
  options: { secret?: boolean; clearAfterSeconds?: number } = {},
) {
  const secret = options.secret ?? false;
  const clearAfterSeconds = options.clearAfterSeconds ?? DEFAULT_SECRET_CLEAR_SECONDS;
  const [status, setStatus] = useState<CopyStatus>("idle");
  // Seconds left until a secret copy is cleared; 0 when no clear is pending.
  const [remaining, setRemaining] = useState(0);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stopTimers = useCallback(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  /** Stop the countdown without clearing the clipboard. */
  const cancelClear = useCallback(() => {
    stopTimers();
    setRemaining(0);
  }, [stopTimers]);

  const copy = useCallback(
    async (value: string) => {
      if (!isClipboardSupported()) {
        setStatus("unsupported");
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        setStatus("unsupported");
        return;
      }

      stopTimers();
      setStatus("copied");

      if (!secret) {
        timeoutRef.current = window.setTimeout(() => setStatus("idle"), DEFAULT_COPIED_FLASH_MS);
        return;
      }

      setRemaining(clearAfterSeconds);
      intervalRef.current = window.setInterval(() => {
        setRemaining((s) => (s <= 1 ? 0 : s - 1));
      }, 1000);
      timeoutRef.current = window.setTimeout(async () => {
        stopTimers();
        setRemaining(0);
        setStatus("idle");
        try {
          // Best-effort: overwrite the clipboard. Browsers don't expose a way
          // to check it still holds what we wrote without a user gesture.
          await navigator.clipboard.writeText("");
        } catch {
          /* clearing is best-effort */
        }
      }, clearAfterSeconds * 1000);
    },
    [secret, clearAfterSeconds, stopTimers],
  );

  return {
    copy,
    status,
    /** Seconds remaining until auto-clear; 0 when idle or not a secret copy. */
    remaining,
    cancelClear,
    supported: isClipboardSupported(),
  };
}
