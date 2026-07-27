/**
 * Local spend-authorization audit log (#556).
 *
 * Shows every signature the wallet has authorized (transaction or message),
 * with a timestamp, so the user can notice unexpected key usage. The log is
 * encrypted at rest (see lib/signingAuditLog.ts) and never leaves the device.
 */

import { useCallback, useEffect, useState } from "react";
import {
  clearSigningAuditLog,
  subscribeToSigningAuditLog,
  type SigningAuditEntry,
} from "../lib/signingAuditLog";

const card = "rounded-2xl border border-ink-700 bg-ink-900/60 p-5";

const ACTION_LABEL: Record<SigningAuditEntry["actionType"], string> = {
  transaction: "Transaction signed",
  message: "Message signed",
};

export function SigningAuditLogSettings() {
  const [entries, setEntries] = useState<readonly SigningAuditEntry[]>([]);
  const [clearing, setClearing] = useState(false);

  useEffect(() => subscribeToSigningAuditLog(setEntries), []);

  const handleClear = useCallback(async () => {
    setClearing(true);
    await clearSigningAuditLog();
    setClearing(false);
  }, []);

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white">Spend-authorization log</h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-mist/70">
            Every time this wallet authorizes a transaction or message signature, an entry
            is recorded here with a timestamp and action type. The log is encrypted on this
            device and is never transmitted anywhere.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={clearing || entries.length === 0}
          className="min-h-9 shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {clearing ? "Clearing…" : "Clear log"}
        </button>
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-medium text-white">
          Signing events {entries.length > 0 && `(${entries.length})`}
        </h4>
        {entries.length === 0 ? (
          <p className="mt-1 text-xs text-mist/50">No signing events recorded yet.</p>
        ) : (
          <ul className="mt-2 max-h-80 space-y-1.5 overflow-auto">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-950/40 px-3 py-2 text-xs"
              >
                <span className="text-white">{ACTION_LABEL[entry.actionType]}</span>
                <span className="font-mono text-mist/60">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
