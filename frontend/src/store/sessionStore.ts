/**
 * Session timeout for connected wallet state (#488).
 *
 * Long-lived wallet sessions on shared devices increase exposure. This store
 * holds the *configuration* (persisted): whether the idle timeout is enabled
 * and how many idle minutes before lock. The `locked` flag is runtime-only and
 * is never persisted — it is set by the session-timeout hook when idle time is
 * exceeded, and cleared on reconnect.
 *
 * Locking clears ephemeral session keys (the in-memory signature session and
 * the connected-wallet state) but deliberately does NOT touch the persisted,
 * encrypted backup in `vaultStore`.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

const SESSION_STORAGE_KEY = "opaque-session-settings";

export const IDLE_TIMEOUT_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "60 minutes" },
] as const;

export type IdleTimeoutMinutes = (typeof IDLE_TIMEOUT_OPTIONS)[number]["value"];

interface SessionState {
  idleTimeoutEnabled: boolean;
  idleTimeoutMinutes: IdleTimeoutMinutes;
  // Runtime-only (not persisted).
  locked: boolean;

  setIdleTimeoutEnabled: (enabled: boolean) => void;
  setIdleTimeoutMinutes: (minutes: IdleTimeoutMinutes) => void;
  setLocked: (locked: boolean) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      idleTimeoutEnabled: true,
      idleTimeoutMinutes: 15,
      locked: false,

      setIdleTimeoutEnabled: (enabled) => set({ idleTimeoutEnabled: enabled }),
      setIdleTimeoutMinutes: (minutes) => set({ idleTimeoutMinutes: minutes }),
      setLocked: (locked) => set({ locked }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      // Only persist the user's configuration; `locked` is derived at runtime.
      partialize: (state) => ({
        idleTimeoutEnabled: state.idleTimeoutEnabled,
        idleTimeoutMinutes: state.idleTimeoutMinutes,
      }),
    },
  ),
);
