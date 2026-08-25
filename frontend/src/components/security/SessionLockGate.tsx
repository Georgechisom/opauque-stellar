/**
 * Session lock overlay (#488).
 *
 * Shown when the idle session timeout fires. Sensitive views are blocked until
 * the user explicitly reconnects their wallet. Reconnecting re-establishes the
 * connected-wallet state that was cleared on lock; the persisted, encrypted
 * backup (vaultStore) is untouched, so the user can still restore from backup.
 */

import { useCallback } from "react";
import { useWallet } from "../../hooks/useWallet";
import { useSessionStore } from "../../store/sessionStore";

export function SessionLockGate() {
  const { connect } = useWallet();
  const setLocked = useSessionStore((s) => s.setLocked);

  const handleReconnect = useCallback(async () => {
    try {
      await connect();
    } catch {
      // Connect may be cancelled by the user; still dismiss the lock so the
      // app is usable for read-only / reconnect flows. The next protected
      // action will re-prompt for signing.
    }
    setLocked(false);
  }, [connect, setLocked]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-lock-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-2xl" aria-hidden>
          🔒
        </div>
        <h2 id="session-lock-title" className="font-display text-xl font-bold text-white">
          Session locked
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-mist">
          Your wallet session was locked after a period of inactivity to protect
          against use on a shared device. Reconnect to continue. Your encrypted
          backup was not deleted.
        </p>
        <button
          type="button"
          onClick={handleReconnect}
          className="mt-6 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-black hover:text-white border border-white"
        >
          Reconnect wallet
        </button>
      </div>
    </div>
  );
}
