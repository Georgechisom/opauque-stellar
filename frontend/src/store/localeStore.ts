import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "pseudo" is a QA locale (#549) — see src/lib/i18n/pseudoLocalize.ts. */
export type Locale = "en" | "es" | "pseudo";

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "opaque-locale-settings",
    }
  )
);
