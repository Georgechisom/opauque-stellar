/**
 * Inline status shown under a secret-classified copy button (#557): counts
 * down to the clipboard auto-clear, lets the user cancel it, and surfaces a
 * warning when the platform doesn't support clearing the clipboard at all.
 */

import type { CopyStatus } from "../hooks/useCopyToClipboard";

export function CopyStatusHint({
  status,
  remaining,
  onCancelClear,
}: {
  status: CopyStatus;
  remaining: number;
  onCancelClear: () => void;
}) {
  if (status === "unsupported") {
    return (
      <p className="mt-1.5 text-[10px] text-warning">
        Copied, but this browser can't auto-clear the clipboard. Clear it yourself once you're
        done.
      </p>
    );
  }
  if (status === "copied" && remaining > 0) {
    return (
      <p className="mt-1.5 flex items-center gap-2 text-[10px] text-mist/70">
        Clipboard clears in {remaining}s
        <button
          type="button"
          onClick={onCancelClear}
          className="font-medium text-mist/70 underline hover:text-white"
        >
          Cancel
        </button>
      </p>
    );
  }
  return null;
}
