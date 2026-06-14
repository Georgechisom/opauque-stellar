import { useState } from "react";
import { useSecurityStore } from "../../store/securityStore";
import { RecoveryDocLink } from "../RecoveryDocLink";
import { ModalShell } from "../ModalShell";

export const BackupReminderModal = ({
  type,
  onProceed,
  onCancel,
}: {
  type: "send" | "receive";
  onProceed: () => void;
  onCancel: () => void;
}) => {
  const { hasBackedUp, hasAcknowledgedReceiveRisk, setHasAcknowledgedReceiveRisk } = useSecurityStore();
  const [understood, setUnderstood] = useState(false);

  if (type === "send" && hasBackedUp) return null;
  if (type === "receive" && hasAcknowledgedReceiveRisk) return null;

  const handleConfirm = () => {
    if (understood) {
      if (type === "receive") setHasAcknowledgedReceiveRisk(true);
      onProceed();
    }
  };

  const message =
    type === "send"
      ? "I have backed up my stealth recovery data."
      : "I understand funds may be unrecoverable without backups.";

  return (
    <ModalShell open title="Backup reminder" onClose={onCancel} maxWidthClassName="max-w-md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-mist">
          Stealth address recovery relies entirely on your local keys. Without a backup, if you lose
          your device, your funds are permanently lost.{" "}
          <RecoveryDocLink section="what-to-backup" className="font-medium text-white underline hover:text-mist">
            What to back up
          </RecoveryDocLink>
        </p>

        <label
          htmlFor="backup-ack"
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700 bg-ink-950/40 p-3"
        >
          <input
            type="checkbox"
            id="backup-ack"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-white"
          />
          <span className="text-sm font-medium text-white">{message}</span>
        </label>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-ink-700 px-4 py-2.5 text-sm font-semibold text-mist transition-colors hover:border-ink-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!understood}
            className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-ink-950 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proceed
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
