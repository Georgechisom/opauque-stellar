/**
 * Adaptive backoff for Horizon balance polling (#542).
 *
 * Fixed-interval balance polling amplifies load during Horizon incidents
 * and trips rate limits. This module tracks backoff state so callers can
 * adjust their polling intervals dynamically.
 *
 * - 429 and 5xx responses trigger increasing intervals with jitter.
 * - A successful response restores the base interval.
 * - Backoff state is exposed for the diagnostics view.
 */

export type BackoffState = {
  /** Current polling interval in ms (base * backoffMultiplier + jitter). */
  currentIntervalMs: number;
  /** Base interval configured by the caller. */
  baseIntervalMs: number;
  /** Number of consecutive failures since last success. */
  consecutiveFailures: number;
  /** Whether the last request succeeded. */
  lastRequestSucceeded: boolean;
  /** Timestamp of the last failure. */
  lastFailureAt: number | null;
  /** Timestamp of the last success. */
  lastSuccessAt: number | null;
};

type BackoffListener = (state: BackoffState) => void;

const BASE_BACKOFF_FACTOR = 2;
const MAX_BACKOFF_EXPONENT = 6;
const JITTER_RANGE = 0.3;

export class AdaptiveBackoff {
  private baseIntervalMs: number;
  private consecutiveFailures = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private listeners = new Set<BackoffListener>();

  constructor(baseIntervalMs: number) {
    this.baseIntervalMs = baseIntervalMs;
  }

  getState(): BackoffState {
    const exponent = Math.min(this.consecutiveFailures, MAX_BACKOFF_EXPONENT);
    const multiplier = Math.pow(BASE_BACKOFF_FACTOR, exponent);
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_RANGE;
    const currentIntervalMs = Math.round(this.baseIntervalMs * multiplier * jitter);

    return {
      currentIntervalMs: this.consecutiveFailures > 0 ? currentIntervalMs : this.baseIntervalMs,
      baseIntervalMs: this.baseIntervalMs,
      consecutiveFailures: this.consecutiveFailures,
      lastRequestSucceeded: this.lastSuccessAt !== null && this.lastSuccessAt > (this.lastFailureAt ?? 0),
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = Date.now();
    this.notify();
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = Date.now();
    this.notify();
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureAt = null;
    this.lastSuccessAt = null;
    this.notify();
  }

  onStateChange(listener: BackoffListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

let globalPollingBackoff: AdaptiveBackoff | null = null;

export function getPollingBackoff(baseIntervalMs: number): AdaptiveBackoff {
  if (!globalPollingBackoff || globalPollingBackoff.getState().baseIntervalMs !== baseIntervalMs) {
    globalPollingBackoff = new AdaptiveBackoff(baseIntervalMs);
  }
  return globalPollingBackoff;
}

export function resetPollingBackoff(): void {
  globalPollingBackoff?.reset();
}
