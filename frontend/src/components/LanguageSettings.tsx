/**
 * Language switcher wired to the locale catalog (#549).
 */

import { useLocaleStore, type Locale } from "../store/localeStore";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pseudo", label: "Pseudo-locale (QA)" },
];

export function LanguageSettings() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
      <h3 className="text-lg font-semibold text-white">Language</h3>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-mist/70">
        Applies to wallet-connection strings today; more of the app moves onto
        this catalog over time. Pseudo-locale is a QA aid — switch to it to spot
        any string that hasn't been wired into the catalog yet.
      </p>

      <label className="mt-4 block">
        <span className="sr-only">Language</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="input-field"
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
