import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MotionState {
  /** Explicit in-app override; `null` means "follow the OS setting" (#550). */
  reducedMotionOverride: boolean | null;
  setReducedMotionOverride: (val: boolean | null) => void;
}

export const useMotionStore = create<MotionState>()(
  persist(
    (set) => ({
      reducedMotionOverride: null,
      setReducedMotionOverride: (val) => set({ reducedMotionOverride: val }),
    }),
    {
      name: "opaque-motion-settings",
    }
  )
);
