/**
 * Session timeout provider (#488).
 *
 * Watches user activity while a wallet/signature session is active. After the
 * configured idle period with no activity, it:
 *   - locks the app (renders <SessionLockGate/>), requiring reconnect, and
 *   - clears ephemeral session keys via `clearSignatureSession()` + wallet
 *     `disconnect()` — without touching the persisted encrypted backup.
 *
 * Must be mounted inside <StellarWalletProviders> so `useWallet` resolves.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useWallet } from "../../hooks/useWallet";
import { useSessionStore } from "../../store/sessionStore";
import { clearSignatureSession } from "../../lib/signatureSession";
import { SessionLockGate } from "./SessionLockGate";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "focus",
  "visibilitychange",
] as const;

const POLL_INTERVAL_MS = 5_000;

export function SessionTimeoutProvider({ children }: { children: ReactNode }) {
  const { connected, disconnect } = useWallet();
  const idleTimeoutEnabled = useSessionStore((s) => s.idleTimeoutEnabled);
  const idleTimeoutMinutes = useSessionStore((s) => s.idleTimeoutMinutes);
  const locked = useSessionStore((s) => s.locked);
  const setLocked = useSessionStore((s) => s.setLocked);

  const lastActivityRef = useRef<number>(Date.now());
  const lockedRef = useRef<boolean>(locked);
  lockedRef.current = locked;

  const lockSession = useCallback(() => {
    if (lockedRef.current) return;
    // Clear ephemeral session keys. Intentionally does NOT call vaultStore.clear()
    // so the persisted, encrypted backup remains intact.
    clearSignatureSession();
    disconnect();
    setLocked(true);
  }, [disconnect, setLocked]);

  useEffect(() => {
    if (!idleTimeoutEnabled || idleTimeoutMinutes <= 0) return;
    if (!connected) {
      // Nothing sensitive to protect yet; keep the idle clock fresh so we
      // don't immediately lock the moment a wallet connects.
      lastActivityRef.current = Date.now();
      return;
    }

    const recordActivity = () => {
      lastActivityRef.current = Date.now();
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, recordActivity, { passive: true }),
    );

    const interval = window.setInterval(() => {
      if (lockedRef.current) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= idleTimeoutMinutes * 60_000) {
        lockSession();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity));
      window.clearInterval(interval);
    };
  }, [idleTimeoutEnabled, idleTimeoutMinutes, connected, lockSession]);

  return (
    <>
      {children}
      {locked && <SessionLockGate />}
    </>
  );
}
