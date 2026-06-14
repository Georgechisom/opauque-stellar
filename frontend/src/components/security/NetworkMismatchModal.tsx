import { useCallback, useEffect, useState } from "react";
import { isAllowed, getNetworkDetails } from "@stellar/freighter-api";
import { getNetwork, getNetworkPassphrase } from "../../lib/chain";
import { ModalShell } from "../ModalShell";

/**
 * Blocks the app when the connected Freighter wallet is on a different network than
 * the one the app is configured for. Freighter (v2 API) has no programmatic network
 * switch, so we guide the user to switch in the extension and re-check — automatically
 * when they return to the tab, or via the button.
 *
 * Important: this only reads the wallet network when access is already granted and
 * never prompts for access (no setAllowed/requestAccess on a timer) — otherwise the
 * Freighter popup re-appears repeatedly, including on the onboarding screen.
 */
export function NetworkMismatchModal() {
  const expected = getNetwork(); // the app's configured network (VITE_STELLAR_NETWORK)
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      if (!(await isAllowed())) {
        // Not connected yet — nothing to reconcile, and we must not prompt here.
        setMismatch(false);
        setWalletNetwork(null);
        return;
      }
      const details = await getNetworkDetails();
      setWalletNetwork((details?.network ?? "unknown").toLowerCase());
      // Compare by canonical network passphrase — exact across all networks (Freighter
      // reports mainnet as "PUBLIC", so name matching would be wrong).
      setMismatch(details?.networkPassphrase !== getNetworkPassphrase());
    } catch {
      // Can't read the wallet network — don't block; the connect flow surfaces wallet errors.
      setMismatch(false);
    } finally {
      setChecking(false);
    }
  }, [expected]);

  useEffect(() => {
    void check();
    // Re-check when the user returns to the tab (likely right after switching in
    // Freighter). No polling/prompting — this is what fixes the repeated popups.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  if (!mismatch) return null;

  return (
    <ModalShell open onClose={() => {}} closeOnBackdrop={false} maxWidthClassName="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <h3 className="font-display text-base font-bold text-white">Wrong network in your wallet</h3>
          <p className="mt-1 text-sm text-mist">
            This app runs on{" "}
            <span className="font-semibold uppercase text-white">{expected}</span>. Switch
            Freighter to continue.
          </p>
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-950/40 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-mist">App network</span>
            <span className="font-mono uppercase text-white">{expected}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-mist">Wallet network</span>
            <span className="font-mono uppercase text-amber-400">{walletNetwork ?? "unknown"}</span>
          </div>
        </div>

        <ol className="list-decimal space-y-1 pl-5 text-sm text-mist">
          <li>Open the Freighter extension.</li>
          <li>
            Switch the network to{" "}
            <span className="font-semibold uppercase text-white">{expected}</span>.
          </li>
          <li>Return here — it re-checks automatically, or use the button below.</li>
        </ol>

        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-white/90 disabled:opacity-60"
        >
          {checking ? "Checking…" : "Re-check network"}
        </button>
      </div>
    </ModalShell>
  );
}
