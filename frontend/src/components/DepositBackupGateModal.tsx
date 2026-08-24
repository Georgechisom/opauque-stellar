import { useState } from "react";
import { ModalShell } from "./ModalShell";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { CopyStatusHint } from "./CopyStatusHint";
import {
  verifyDepositFragment,
  type DepositBackupSession,
} from "../lib/depositBackupGate";

interface DepositBackupGateModalProps {
  session: DepositBackupSession;
  isOpen: boolean;
  isSigning: boolean;
  onConfirmAndSign: () => void;
  onCancel: () => void;
}

export function DepositBackupGateModal({
  session,
  isOpen,
  isSigning,
  onConfirmAndSign,
  onCancel,
}: DepositBackupGateModalProps) {
  const [inputFragment, setInputFragment] = useState("");
  const [isVerified, setIsVerified] = useState(session.verified);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const copyHelper = useCopyToClipboard();

  const noteJson = JSON.stringify(
    {
      cluster: session.cluster,
      amountXlm: session.amountXlm,
      valueStroops: session.valueStroops,
      commitment: session.commitmentHex,
      nullifier: session.nullifierHex,
      secret: session.secretHex,
      createdAt: new Date(session.createdAt).toISOString(),
    },
    null,
    2
  );

  const handleVerify = () => {
    const valid = verifyDepositFragment(session, inputFragment);
    if (valid) {
      setIsVerified(true);
      setErrorMessage(null);
    } else {
      setIsVerified(false);
      setErrorMessage("Fragment does not match. Please verify the characters from your secret.");
    }
  };

  const handleInputChange = (val: string) => {
    setInputFragment(val);
    if (isVerified) setIsVerified(false);
    if (errorMessage) setErrorMessage(null);
  };

  return (
    <ModalShell
      open={isOpen}
      title="Secure Your Note Backup"
      description="You must backup and verify your spending secret before signing the deposit."
      onClose={onCancel}
      closeOnBackdrop={!isSigning}
      maxWidthClassName="max-w-lg"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          <p className="font-semibold text-amber-100">⚠️ Critical Safety Warning</p>
          <p className="mt-1">
            Privacy pool deposits are completely non-custodial. If you lose your Note Secret, your{" "}
            <span className="font-bold text-white">{session.amountXlm} XLM</span> cannot be recovered
            or withdrawn by anyone.
          </p>
        </div>

        <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-950 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mist uppercase tracking-wide">
              Note Spending Secret
            </span>
            <button
              type="button"
              onClick={() => copyHelper.copy(noteJson)}
              className="text-xs font-medium text-glow hover:underline"
            >
              {copyHelper.status === "copied" ? "Copied Backup!" : "Copy Full Note Backup"}
            </button>
          </div>
          <div className="break-all rounded-lg border border-ink-800 bg-ink-900/80 p-2.5 font-mono text-xs text-white select-all">
            {session.secretHex}
          </div>
          <CopyStatusHint
            status={copyHelper.status}
            remaining={copyHelper.remaining}
            onCancelClear={copyHelper.cancelClear}
          />
        </div>

        <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <label htmlFor="backup-verify-input" className="block text-sm font-medium text-white">
            {session.challengePrompt}
          </label>
          <div className="flex gap-2">
            <input
              id="backup-verify-input"
              type="text"
              placeholder="e.g. A1B2C3"
              maxLength={12}
              value={inputFragment}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={isSigning}
              className="flex-1 rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm text-white uppercase placeholder:text-mist/40 focus:border-glow focus:outline-none focus:ring-1 focus:ring-glow disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={isSigning || !inputFragment.trim()}
              className="rounded-xl border border-ink-700 bg-ink-800 px-4 py-2 text-sm font-medium text-white hover:bg-ink-700 disabled:opacity-40"
            >
              Verify
            </button>
          </div>
          {isVerified ? (
            <p className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 mt-1">
              ✓ Note backup verified successfully! You may now sign the transaction.
            </p>
          ) : (
            <p className="text-xs text-mist/60">
              Expected characters match the end of your Note Secret displayed above.
            </p>
          )}
          {errorMessage && (
            <p className="text-xs text-red-400 font-medium mt-1">{errorMessage}</p>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSigning}
            className="min-h-10 rounded-xl border border-ink-700 px-4 py-2 text-sm font-medium text-mist transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
          >
            Cancel Deposit
          </button>
          <button
            type="button"
            onClick={onConfirmAndSign}
            disabled={!isVerified || isSigning}
            aria-busy={isSigning ? "true" : undefined}
            className="min-h-10 rounded-xl bg-glow px-4 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffe24f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSigning ? "Submitting Transaction…" : "Confirm & Sign Deposit"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
