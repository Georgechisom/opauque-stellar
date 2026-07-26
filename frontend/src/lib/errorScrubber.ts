/**
 * Scrubber for opt-in error reports (#560).
 *
 * Naive telemetry from a privacy wallet is worse than no telemetry: a stack trace or
 * an error message can carry a stealth address, a withdrawal amount, or note-spending
 * material, and a crash report is enough to link a user to a "private" transaction.
 *
 * This module reduces an arbitrary payload to something that still identifies a *bug*
 * but not a *person*. It is deliberately aggressive:
 *
 *  - Anything shaped like a Stellar/Soroban address becomes a placeholder.
 *  - Anything shaped like key material (S-addresses, long hex, base64 blobs) is dropped
 *    and replaced with a length marker, never a prefix.
 *  - Amounts are redacted, including bare long digit runs. This over-redacts (ledger
 *    sequences go too) — an exact stroop amount plus a timestamp deanonymises a
 *    withdrawal, so precision loses to privacy here.
 *  - Object keys that name secrets are dropped by key, before their values are even
 *    inspected, so an unexpected value shape cannot leak through.
 *
 * The scrubber is pure, deterministic, and idempotent: `scrub(scrub(x))` equals
 * `scrub(x)`. That is what lets the UI show the user the exact bytes that will be sent.
 */

/** Placeholders. Stable strings — the tests and the UI preview both rely on them. */
export const REDACTED = {
  account: "[stellar-account]",
  contract: "[contract-address]",
  secretKey: "[secret-key]",
  amount: "[amount]",
  email: "[email]",
  mnemonic: "[mnemonic]",
  value: "[redacted]",
  query: "[query]",
} as const;

/**
 * Object keys whose *values* are dropped outright regardless of shape. Matched
 * case-insensitively as a substring, so `newNullifier` and `note_secret` both hit.
 */
export const SECRET_KEY_PATTERN =
  /(secret|seed|mnemonic|private|passphrase|password|pin|nullifier|commitment|preimage|witness|zkey|proof|signature|x25519|pubkey|publickey|note|memo|entropy|salt|token|auth|cookie)/i;

/** Object keys whose values are amounts. Numeric values here become `[amount]`. */
export const AMOUNT_KEY_PATTERN =
  /(amount|value|balance|fee|stroops|lumens|withdrawn|deposit|stake|quantity|total)/i;

// Ordered: secret seeds must be matched before the generic account pattern, and both
// before the hex pattern, which would otherwise nibble at base32 that is all [A-F2-7].
const STELLAR_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;
const STELLAR_ACCOUNT_RE = /\b[GM][A-Z2-7]{55}\b/g;
const CONTRACT_RE = /\bC[A-Z2-7]{55}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const MNEMONIC_RE = /\b(?:[a-z]{3,8}[ \t]+){11,23}[a-z]{3,8}\b/g;
const HEX_RE = /\b(?:0x)?[0-9a-fA-F]{16,}\b/g;
const BASE64_RE = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;
const QUALIFIED_AMOUNT_RE = /\b\d[\d,_]*(?:\.\d+)?\s*(?:XLM|stroops|lumens)\b/gi;
const DECIMAL_AMOUNT_RE = /\b\d[\d,]*\.\d+\b/g;
const LONG_DIGITS_RE = /\b\d{7,}n?\b/g;

function hexPlaceholder(match: string): string {
  const digits = match.replace(/^0x/i, "");
  return `[hex:${Math.ceil(digits.length / 2)}b]`;
}

/**
 * Strip the query string and fragment from any URL, keeping origin + path. Payment
 * links carry the stealth address and amount in the query, so it never survives.
 */
function scrubUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (match) => {
    try {
      const url = new URL(match);
      return url.search || url.hash
        ? `${url.origin}${url.pathname}?${REDACTED.query}`
        : `${url.origin}${url.pathname}`;
    } catch {
      return REDACTED.value;
    }
  });
}

/**
 * Redact every sensitive pattern in a free-text string.
 *
 * Idempotent: placeholders contain no characters that the patterns match, so a second
 * pass is a no-op.
 */
export function scrubText(input: string): string {
  return scrubUrls(input)
    .replace(EMAIL_RE, REDACTED.email)
    .replace(STELLAR_SECRET_RE, REDACTED.secretKey)
    .replace(STELLAR_ACCOUNT_RE, REDACTED.account)
    .replace(CONTRACT_RE, REDACTED.contract)
    .replace(MNEMONIC_RE, REDACTED.mnemonic)
    .replace(HEX_RE, hexPlaceholder)
    .replace(BASE64_RE, (m) => `[b64:${m.length}]`)
    .replace(QUALIFIED_AMOUNT_RE, REDACTED.amount)
    .replace(DECIMAL_AMOUNT_RE, REDACTED.amount)
    .replace(LONG_DIGITS_RE, REDACTED.amount);
}

/**
 * Reduce a stack trace to frames without local paths.
 *
 * A `file://` or `blob:` origin can carry an OS username; a bundled asset path is all
 * we need to locate a bug. Only the first `maxFrames` frames are kept.
 */
export function scrubStack(stack: string | undefined, maxFrames = 8): string[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1) // drop the message line; it is reported separately (and scrubbed)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxFrames)
    .map((line) =>
      scrubText(
        line
          // Keep only the trailing `<file>:<line>:<col>` of any URL or path.
          .replace(/(?:[a-z]+:\/\/[^\s)]*\/|\/[^\s)]*\/)([^/\s)]+:\d+:\d+)/gi, "$1")
          .replace(/\\/g, "/"),
      ),
    );
}

/**
 * Coarsen a user agent to browser + platform family. The full string is a strong
 * fingerprint; "Firefox on Linux" is enough to reproduce a rendering bug.
 */
export function scrubUserAgent(userAgent: string | undefined): string {
  if (!userAgent) return "unknown";
  const browser =
    /\bFirefox\/\d+/.test(userAgent)
      ? "Firefox"
      : /\bEdg\/\d+/.test(userAgent)
        ? "Edge"
        : /\bChrome\/\d+/.test(userAgent)
          ? "Chrome"
          : /\bSafari\/\d+/.test(userAgent)
            ? "Safari"
            : "other";
  const platform = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(userAgent)
      ? "iOS"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "other";
  return `${browser} on ${platform}`;
}

/**
 * Round a timestamp down to the hour. Millisecond precision correlates a report with
 * an on-chain transaction; an hour bucket is enough to order events during triage.
 */
export function coarsenTimestamp(timestamp: number): number {
  const HOUR_MS = 60 * 60 * 1000;
  return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
}

/**
 * Deep-scrub an arbitrary value.
 *
 * Keys are inspected first: a key naming a secret drops its value without looking at
 * it. Cycles collapse to `[circular]`; depth and array length are bounded so a
 * pathological payload cannot blow up the report.
 */
export function scrubValue(input: unknown, keyHint = ""): unknown {
  return scrubInner(input, keyHint, new WeakSet(), 0);
}

const MAX_DEPTH = 6;
const MAX_ARRAY = 20;

function scrubInner(
  input: unknown,
  keyHint: string,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (input === null || input === undefined) return input;
  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof input === "string") {
    return AMOUNT_KEY_PATTERN.test(keyHint) ? REDACTED.amount : scrubText(input);
  }
  if (typeof input === "number") {
    if (AMOUNT_KEY_PATTERN.test(keyHint)) return REDACTED.amount;
    // Bare large numbers are amounts or ledger positions far more often than they
    // are useful diagnostics.
    return Math.abs(input) >= 1_000_000 ? REDACTED.amount : input;
  }
  if (typeof input === "bigint") return REDACTED.amount;
  if (typeof input === "boolean") return input;
  if (typeof input === "function") return "[function]";
  if (input instanceof Uint8Array) return `[bytes:${input.length}]`;
  if (input instanceof Error) {
    return {
      name: input.name,
      message: scrubText(input.message),
      stack: scrubStack(input.stack),
    };
  }
  if (Array.isArray(input)) {
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    const items = input
      .slice(0, MAX_ARRAY)
      .map((item) => scrubInner(item, keyHint, seen, depth + 1));
    if (input.length > MAX_ARRAY) items.push(`[+${input.length - MAX_ARRAY} more]`);
    return items;
  }
  if (typeof input === "object") {
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED.value;
        continue;
      }
      out[key] = scrubInner(value, key, seen, depth + 1);
    }
    return out;
  }
  return REDACTED.value;
}
