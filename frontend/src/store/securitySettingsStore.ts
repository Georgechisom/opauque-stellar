/**
 * Security settings store: manages the optional encryption passphrase
 * for sensitive localStorage stores (tx history, pool notes, reputation).
 *
 * The passphrase is held in memory only — never persisted. When set,
 * sensitive stores encrypt their data at rest using AES-256-GCM via
 * the encryptedStorage module.
 *
 * See docs/GHOST_THREAT_MODEL.md for the broader encryption threat model.
 */

import { create } from "zustand";

const STORAGE_KEY = "opaque-security-settings";

type SecuritySettingsState = {
  /** Whether encryption is enabled (passphrase must be set on each session). */
  encryptionEnabled: boolean;
  /** The in-memory passphrase. Null until the user enters it for the session. */
  _passphrase: string | null;

  /** Enable encryption (persists the preference). */
  enableEncryption: () => void;
  /** Disable encryption (persists the preference). */
  disableEncryption: () => void;
  /** Set the passphrase for the current session. */
  setPassphrase: (passphrase: string) => void;
  /** Clear the passphrase from memory (e.g. on lock). */
  clearPassphrase: () => void;
  /** Get the current passphrase (or null if not set). */
  getPassphrase: () => string | null;
};

function loadSettings(): { encryptionEnabled: boolean } {
  try {
    if (typeof localStorage === "undefined") return { encryptionEnabled: false };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { encryptionEnabled: false };
    const parsed = JSON.parse(raw) as { encryptionEnabled?: boolean };
    return { encryptionEnabled: parsed.encryptionEnabled ?? false };
  } catch {
    return { encryptionEnabled: false };
  }
}

function persistSettings(encryptionEnabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ encryptionEnabled }));
  } catch {
    // Silently fail
  }
}

export const useSecuritySettingsStore = create<SecuritySettingsState>()(
  (set, get) => ({
    encryptionEnabled: loadSettings().encryptionEnabled,
    _passphrase: null,

    enableEncryption: () => {
      persistSettings(true);
      set({ encryptionEnabled: true });
    },

    disableEncryption: () => {
      persistSettings(false);
      set({ encryptionEnabled: false, _passphrase: null });
    },

    setPassphrase: (passphrase: string) => {
      set({ _passphrase: passphrase });
    },

    clearPassphrase: () => {
      set({ _passphrase: null });
    },

    getPassphrase: () => get()._passphrase,
  }),
);
