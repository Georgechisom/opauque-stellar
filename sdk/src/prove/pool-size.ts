/**
 * Default worker-pool sizing: available CPU cores minus one, so proving leaves
 * one core free for the main thread (UI in a browser, event loop in Node).
 */

/** `max(1, cores - 1)` — pure so it's testable without mocking globals. */
export function poolSizeFromCoreCount(cores: number): number {
  if (!Number.isFinite(cores) || cores <= 0) return 1;
  return Math.max(1, Math.floor(cores) - 1);
}

/**
 * Detect the available core count for this runtime (browser `navigator` or
 * Node `os`) and return a sensible default pool size. Falls back to 1 (serial)
 * when core count can't be determined — a constrained environment.
 */
export async function defaultPoolSize(): Promise<number> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.hardwareConcurrency === "number" &&
    navigator.hardwareConcurrency > 0
  ) {
    return poolSizeFromCoreCount(navigator.hardwareConcurrency);
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const os = await import("node:os");
      const cores =
        typeof os.availableParallelism === "function"
          ? os.availableParallelism()
          : os.cpus().length;
      return poolSizeFromCoreCount(cores);
    } catch {
      return 1;
    }
  }
  return 1;
}
