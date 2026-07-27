/**
 * Pseudo-localization (#549): visually mangles real catalog strings (accents +
 * brackets + padding) so any hardcoded string that bypassed the catalog stands
 * out immediately in the pseudo-locale build — it renders as plain, unmangled
 * English while everything routed through `t()` looks like this.
 */

const ACCENTED: Record<string, string> = {
  a: "á",
  e: "é",
  i: "í",
  o: "ó",
  u: "ú",
  A: "Á",
  E: "É",
  I: "Í",
  O: "Ó",
  U: "Ú",
};

export function pseudoLocalize(str: string): string {
  const accented = str.replace(/[aeiouAEIOU]/g, (c) => ACCENTED[c] ?? c);
  const padLength = Math.ceil(str.length * 0.3);
  const padding = "~".repeat(padLength);
  return `⟦${accented}${padding}⟧`;
}
