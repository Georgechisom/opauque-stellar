import { useCallback, useEffect, useMemo, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import type { Tab } from "./Layout";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../context/ToastContext";
import { usePoolNoteStore } from "../store/poolNoteStore";
import { getPoolConfig } from "../contracts/poolConfig";
import {
  buildEncryptedPoolNoteBackup,
  downloadBlob,
  poolNoteBackupFilename,
} from "../lib/poolNoteBackup";
import { deriveDeposit, newNoteSecrets, toHex32, unspentTotal, type PoolNote } from "../lib/poolNotes";
import { invokePoolDeposit, invokePoolWithdraw } from "../lib/programs";
import {
  fetchNextLeafIndex,
  fetchPoolBalance,
  fetchPoolRoots,
  generateWithdrawProof,
} from "../lib/poolProver";

const STROOPS_PER_XLM = 10_000_000n;

function parseXlm(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const padded = (frac + "0000000").slice(0, 7);
  const v = BigInt(whole) * STROOPS_PER_XLM + BigInt(padded || "0");
  return v > 0n ? v : null;
}

function formatXlm(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

function be32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let n = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

const card = "rounded-2xl border border-ink-700 bg-ink-900/60 p-5";

export function PoolView({ readOnly = false }: { onNavigate?: (tab: Tab) => void; readOnly?: boolean }) {
  const wallet = useWallet();
  const { publicKey, signTransaction, connected } = wallet;
  const cluster = wallet.cluster ?? "testnet";
  const { showToast } = useToast();
  const cfg = useMemo(() => {
    void cluster;
    return getPoolConfig();
  }, [cluster]);

  const notes = usePoolNoteStore((s) => s.notes);
  const addNote = usePoolNoteStore((s) => s.addNote);
  const markSpent = usePoolNoteStore((s) => s.markSpent);

  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPin, setBackupPin] = useState("");
  const [backupConfirm, setBackupConfirm] = useState("");
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [poolBalance, setPoolBalance] = useState<bigint | null>(null);
  const [roots, setRoots] = useState<{ stateRoot: string | null; aspRoot: string | null } | null>(null);

  const clusterNotes = notes.filter((n) => n.cluster === cluster && (!n.poolId || n.poolId === cfg?.poolId));
  const unspent = clusterNotes.filter((n) => !n.spent);

  const refreshChain = useCallback(async () => {
    if (!cfg || !publicKey) return;
    try {
      const [bal, r] = await Promise.all([fetchPoolBalance(publicKey), fetchPoolRoots(publicKey)]);
      setPoolBalance(bal);
      setRoots(r);
    } catch {
      /* non-fatal: leave prior values */
    }
  }, [cfg, publicKey]);

  useEffect(() => {
    void refreshChain();
  }, [refreshChain]);

  const closeBackupDialog = useCallback(() => {
    if (backupBusy) return;
    setBackupOpen(false);
    setBackupPin("");
    setBackupConfirm("");
    setBackupAcknowledged(false);
    setBackupError(null);
  }, [backupBusy]);

  useEffect(() => {
    if (!backupOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeBackupDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backupOpen, closeBackupDialog]);

  const handleDeposit = useCallback(async () => {
    if (!cfg || !publicKey || !signTransaction) return;
    const value = parseXlm(amount);
    if (!value) {
      showToast("Enter a valid XLM amount.");
      return;
    }
    setBusy("Depositing…");
    try {
      const leafIndex = await fetchNextLeafIndex(publicKey);
      const { nullifier, secret } = newNoteSecrets();
      const derived = await deriveDeposit({
        value,
        scope: cfg.scope,
        leafIndex,
        nullifier: BigInt(nullifier),
        secret: BigInt(secret),
      });
      const hash = await invokePoolDeposit({
        depositor: publicKey,
        value,
        commitment: be32(derived.commitment),
        expectedIndex: leafIndex,
        signTransaction,
      });
      const note: PoolNote = {
        cluster,
        poolId: cfg.poolId,
        value: value.toString(),
        scope: cfg.scope,
        leafIndex,
        nullifier,
        secret,
        commitment: toHex32(derived.commitment),
        spent: false,
        createdAt: Date.now(),
      };
      addNote(note);
      setAmount("");
      showToast(`Deposited ${formatXlm(value)} XLM into the pool.`, { explorerTx: { txSig: hash } });
      void refreshChain();
    } catch (e) {
      showToast(`Deposit failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [cfg, publicKey, signTransaction, amount, cluster, addNote, showToast, refreshChain]);

  const handleWithdraw = useCallback(async () => {
    if (!cfg || !publicKey || !signTransaction) return;
    const note = unspent.find((n) => n.leafIndex === selected);
    if (!note) {
      showToast("Select a note to withdraw.");
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(recipient)) {
      showToast("Enter a valid recipient address (G…).");
      return;
    }
    try {
      setBusy("Generating proof…");
      const proof = await generateWithdrawProof({
        note,
        recipient,
        fee: 0n,
        relayer: publicKey,
        caller: publicKey,
        onProgress: (stage) => setBusy(`Proving (${stage})…`),
      });
      setBusy("Submitting withdrawal…");
      const hash = await invokePoolWithdraw({
        caller: publicKey,
        proofA: proof.proofA,
        proofB: proof.proofB,
        proofC: proof.proofC,
        withdrawnValue: proof.withdrawnValue,
        stateRoot: proof.stateRoot,
        aspRoot: proof.aspRoot,
        nullifierHash: proof.nullifierHash,
        newCommitment: proof.newCommitment,
        recipient,
        fee: 0n,
        relayer: publicKey,
        signTransaction,
      });
      markSpent(cluster, note.poolId, note.leafIndex);
      setSelected(null);
      showToast(`Withdrew ${formatXlm(proof.withdrawnValue)} XLM to ${recipient.slice(0, 6)}…`, {
        explorerTx: { txSig: hash },
      });
      void refreshChain();
    } catch (e) {
      showToast(`Withdraw failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [cfg, publicKey, signTransaction, unspent, selected, recipient, cluster, markSpent, showToast, refreshChain]);

  const handleBackupSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBackupError(null);
      if (!cfg) return;
      if (clusterNotes.length === 0) {
        setBackupError("There are no pool notes to back up.");
        return;
      }
      if (!backupAcknowledged) {
        setBackupError("Acknowledge the privacy risk before downloading a backup.");
        return;
      }
      if (!/^\d{6,12}$/.test(backupPin)) {
        setBackupError("Use a 6-12 digit PIN.");
        return;
      }
      if (backupPin !== backupConfirm) {
        setBackupError("PINs do not match.");
        return;
      }
      setBackupBusy(true);
      try {
        const blob = await buildEncryptedPoolNoteBackup({
          notes: clusterNotes,
          pin: backupPin,
          cluster,
          poolId: cfg.poolId,
        });
        downloadBlob(blob, poolNoteBackupFilename());
        showToast(`Encrypted backup downloaded with ${clusterNotes.length} note(s).`);
        closeBackupDialog();
      } catch (e) {
        setBackupError((e as Error).message || "Could not create backup.");
      } finally {
        setBackupBusy(false);
      }
    },
    [
      backupAcknowledged,
      backupConfirm,
      backupPin,
      cfg,
      closeBackupDialog,
      cluster,
      clusterNotes,
      showToast,
    ],
  );

  if (!cfg) {
    return (
      <div className="max-w-lg mx-auto py-10 text-center">
        <h1 className="font-display text-xl font-bold text-white">Privacy Pool</h1>
        <p className="mt-3 text-sm text-mist">The privacy pool is not deployed on this network.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-white">Privacy Pool</h1>
        <p className="mt-1 text-sm text-mist">
          Shield XLM behind a commitment, then withdraw to any address with a zero-knowledge proof
          of a clean (ASP-approved) deposit.
        </p>
      </header>

      {/* Balances + ASP status */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className={card}>
          <div className="text-xs uppercase tracking-wide text-mist/70">Your shielded balance</div>
          <div className="mt-1 text-2xl font-bold text-white">{formatXlm(unspentTotal(unspent))} XLM</div>
          <div className="mt-1 text-xs text-mist/60">{unspent.length} unspent note(s)</div>
          <button
            type="button"
            onClick={() => {
              setBackupError(null);
              setBackupOpen(true);
            }}
            disabled={clusterNotes.length === 0 || backupBusy}
            className="mt-4 min-h-10 rounded-xl border border-ink-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:border-glow hover:text-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:cursor-not-allowed disabled:opacity-40"
          >
            Download backup
          </button>
        </div>
        <div className={card}>
          <div className="text-xs uppercase tracking-wide text-mist/70">Pool TVL (on-chain)</div>
          <div className="mt-1 text-2xl font-bold text-white">
            {poolBalance == null ? "…" : `${formatXlm(poolBalance)} XLM`}
          </div>
        </div>
        <div className={card}>
          <div className="text-xs uppercase tracking-wide text-mist/70">ASP status</div>
          <div className="mt-1 text-sm font-medium text-white">
            {roots?.aspRoot ? "Root published" : "No root yet"}
          </div>
          <div className="mt-1 break-all font-mono text-[10px] text-mist/50">
            {roots?.aspRoot ? `${roots.aspRoot.slice(0, 18)}…` : "—"}
          </div>
        </div>
      </div>

      {/* Deposit */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-white">Deposit</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount in XLM"
            disabled={readOnly || !!busy}
            className="flex-1 rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white placeholder:text-mist/40 focus:border-glow focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleDeposit}
            disabled={readOnly || !connected || !!busy}
            className="rounded-xl bg-glow px-5 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffe24f] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "Depositing…" ? "Depositing…" : "Deposit"}
          </button>
        </div>
        <p className="mt-2 text-xs text-mist/60">
          A secret note is generated and saved locally. Keep your backup — losing notes loses the
          funds.
        </p>
      </div>

      {/* Withdraw */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-white">Withdraw</h2>
        {unspent.length === 0 ? (
          <p className="mt-3 text-sm text-mist/60">No unspent notes. Deposit first.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              {unspent.map((n) => (
                <label
                  key={n.leafIndex}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors ${
                    selected === n.leafIndex
                      ? "border-glow bg-black/30 text-white"
                      : "border-ink-700 text-mist hover:border-white/30"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="note"
                      checked={selected === n.leafIndex}
                      onChange={() => setSelected(n.leafIndex)}
                      className="accent-glow"
                    />
                    {formatXlm(BigInt(n.value))} XLM
                  </span>
                  <span className="font-mono text-[10px] text-mist/50">leaf #{n.leafIndex}</span>
                </label>
              ))}
            </div>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Recipient address (G…)"
              disabled={readOnly || !!busy}
              className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs text-white placeholder:text-mist/40 focus:border-glow focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={readOnly || !connected || !!busy || selected == null}
              className="w-full rounded-xl bg-glow px-5 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffe24f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && busy !== "Depositing…" ? busy : "Withdraw (full)"}
            </button>
            <p className="text-xs text-mist/60">
              v1 withdraws the full note to a fresh address. The proof attests your deposit is in the
              pool and ASP-approved, without revealing which one.
            </p>
          </div>
        )}
      </div>

      {backupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pool-note-backup-title"
        >
          <form
            onSubmit={handleBackupSubmit}
            className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-950 p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="pool-note-backup-title" className="text-lg font-semibold text-white">
                  Back up pool notes
                </h2>
                <p className="mt-1 text-sm text-mist/70">
                  This backup contains encrypted spending material for {clusterNotes.length} note(s).
                </p>
              </div>
              <button
                type="button"
                onClick={closeBackupDialog}
                disabled={backupBusy}
                aria-label="Close backup dialog"
                className="min-h-10 min-w-10 rounded-xl border border-ink-700 text-mist transition-colors hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:cursor-not-allowed disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              Anyone with the decrypted notes can withdraw the matching pool funds. Store the ZIP and
              PIN separately. If you lose the PIN, this backup cannot be recovered.
            </div>

            <div className="mt-4 space-y-4">
              <label className="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3 text-sm text-mist">
                <input
                  type="checkbox"
                  checked={backupAcknowledged}
                  onChange={(e) => setBackupAcknowledged(e.target.checked)}
                  className="mt-1 accent-glow"
                />
                <span>I understand this backup protects funds and must be kept private.</span>
              </label>

              <div className="space-y-1.5">
                <label htmlFor="pool-backup-pin" className="block text-sm font-medium text-white">
                  Backup PIN
                </label>
                <input
                  id="pool-backup-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={backupPin}
                  onChange={(e) => setBackupPin(e.target.value)}
                  disabled={backupBusy}
                  aria-invalid={backupError ? "true" : undefined}
                  aria-describedby={backupError ? "pool-backup-error" : "pool-backup-pin-help"}
                  className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder:text-mist/40 focus:border-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:opacity-50"
                />
                <p id="pool-backup-pin-help" className="text-xs text-mist/60">
                  Use 6-12 digits. This PIN encrypts the note JSON inside the ZIP.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="pool-backup-pin-confirm" className="block text-sm font-medium text-white">
                  Confirm PIN
                </label>
                <input
                  id="pool-backup-pin-confirm"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={backupConfirm}
                  onChange={(e) => setBackupConfirm(e.target.value)}
                  disabled={backupBusy}
                  aria-invalid={backupError ? "true" : undefined}
                  aria-describedby={backupError ? "pool-backup-error" : undefined}
                  className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder:text-mist/40 focus:border-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:opacity-50"
                />
              </div>

              {backupError && (
                <p id="pool-backup-error" className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
                  {backupError}
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeBackupDialog}
                disabled={backupBusy}
                className="min-h-10 rounded-xl border border-ink-700 px-4 py-2 text-sm font-medium text-mist transition-colors hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={backupBusy}
                aria-busy={backupBusy ? "true" : undefined}
                className="min-h-10 rounded-xl bg-glow px-4 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffe24f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:cursor-not-allowed disabled:opacity-40"
              >
                {backupBusy ? "Encrypting…" : "Download encrypted ZIP"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
