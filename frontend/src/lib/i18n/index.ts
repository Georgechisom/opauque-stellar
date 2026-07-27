import { useLocaleStore, type Locale } from "../../store/localeStore";
import { en, es, type LocaleKey } from "./catalog";
import { pseudoLocalize } from "./pseudoLocalize";

export type { Locale } from "../../store/localeStore";
export type { LocaleKey } from "./catalog";

const CATALOGS: Record<"en" | "es", Record<LocaleKey, string>> = { en, es };

export function translate(
  locale: Locale,
  key: LocaleKey,
  vars?: Record<string, string | number>,
): string {
  const base = locale === "pseudo" ? en[key] : (CATALOGS[locale]?.[key] ?? en[key]);
  const interpolated = vars
    ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), base)
    : base;
  return locale === "pseudo" ? pseudoLocalize(interpolated) : interpolated;
}

/** Resolves catalog strings against the persisted locale preference (#549). */
export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const t = (key: LocaleKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
  return { t, locale };
}
