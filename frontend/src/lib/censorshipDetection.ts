/**
 * Client-side censorship detection (#616).
 *
 * A relayer that accepted a job can simply never submit it. The escrow eventually
 * becomes recoverable (cancel/slash), but nothing today tells the user *why* their
 * withdrawal is stuck, or steers future picks away from a relayer that has done this
 * before. This module tracks that locally, in the browser the user is already using.
 */

const STORAGE_KEY = "opaque:stalled-relayers";
/** Recent stalls matter more than old ones; older records stop affecting selection. */
const RELEVANT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** How long a job may sit "delivered, waiting for submission" before it counts as stalled. */
export const STALL_THRESHOLD_MS = 120_000;

export type StalledRelayerRecord = {
  operator: string;
  jobId: string;
  at: number;
};

function readAll(): StalledRelayerRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is StalledRelayerRecord =>
        !!r &&
        typeof (r as StalledRelayerRecord).operator === "string" &&
        typeof (r as StalledRelayerRecord).jobId === "string" &&
        typeof (r as StalledRelayerRecord).at === "number",
    );
  } catch {
    return [];
  }
}

function writeAll(records: StalledRelayerRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable (private mode, quota) — detection just won't persist */
  }
}

/** Note that `operator` failed to submit `jobId` in time, for future relayer selection. */
export function recordStalledRelayer(record: StalledRelayerRecord): void {
  const records = readAll();
  records.push(record);
  writeAll(records);
}

/** All recorded stalls within the relevant window, newest first. */
export function getStalledRelayers(now = Date.now()): StalledRelayerRecord[] {
  const cutoff = now - RELEVANT_WINDOW_MS;
  return readAll()
    .filter((r) => r.at >= cutoff)
    .sort((a, b) => b.at - a.at);
}

export function isRelayerStalled(operator: string, now = Date.now()): boolean {
  return getStalledRelayers(now).some((r) => r.operator === operator);
}

/**
 * Reorders/filters a bid list so previously-stalled relayers are avoided when picking
 * automatically. Never returns an empty list if `bids` wasn't empty — a relayer that
 * stalled once is still better than no relayer at all.
 */
export function preferNonStalledBids<T extends { operator: string }>(bids: readonly T[]): T[] {
  const clean = bids.filter((b) => !isRelayerStalled(b.operator));
  return clean.length > 0 ? clean : [...bids];
}
