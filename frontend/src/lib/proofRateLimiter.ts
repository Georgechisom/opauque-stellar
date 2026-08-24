/**
 * Proof generation rate limiter to prevent DoS self-harm.
 *
 * Throttles concurrent proof generation jobs and caps retries per session
 * to prevent malicious or buggy loops from freezing the browser.
 */

export interface ProofRateLimitConfig {
  maxConcurrentProofs: number;
  maxRetriesPerSession: number;
  retryWindowMs: number;
}

export const DEFAULT_PROOF_RATE_LIMIT: ProofRateLimitConfig = {
  maxConcurrentProofs: 2,
  maxRetriesPerSession: 5,
  retryWindowMs: 60000, // 1 minute sliding window for retries
};

class ProofRateLimiter {
  private concurrentCount = 0;
  private retries: number[] = [];
  private config: ProofRateLimitConfig;

  constructor(config: Partial<ProofRateLimitConfig> = {}) {
    this.config = { ...DEFAULT_PROOF_RATE_LIMIT, ...config };
  }

  /**
   * Acquires a proof generation slot. Throws if limit exceeded.
   * Returns a release function that must be called when proof completes.
   */
  acquireSlot(): () => void {
    if (this.concurrentCount >= this.config.maxConcurrentProofs) {
      throw new Error(
        `Too many concurrent proofs (max ${this.config.maxConcurrentProofs}). ` +
        `Please wait for current proofs to complete.`
      );
    }
    this.concurrentCount++;
    return () => {
      this.concurrentCount--;
    };
  }

  /**
   * Records a proof retry attempt. Throws if retry limit exceeded in the window.
   */
  recordRetry(): void {
    const now = Date.now();
    // Remove retries older than the window
    this.retries = this.retries.filter((t) => now - t < this.config.retryWindowMs);

    if (this.retries.length >= this.config.maxRetriesPerSession) {
      throw new Error(
        `Too many proof retries (${this.retries.length} in ${this.config.retryWindowMs}ms). ` +
        `Please clear the throttle from settings.`
      );
    }
    this.retries.push(now);
  }

  /**
   * Returns the number of pending concurrent proofs.
   */
  getPendingCount(): number {
    return this.concurrentCount;
  }

  /**
   * Returns the number of retries in the current window.
   */
  getRetriesInWindow(): number {
    const now = Date.now();
    this.retries = this.retries.filter((t) => now - t < this.config.retryWindowMs);
    return this.retries.length;
  }

  /**
   * Clears all throttle state (retries and resets to 0 concurrent).
   * Called by user action from settings.
   */
  clearThrottle(): void {
    this.concurrentCount = 0;
    this.retries = [];
  }

  /**
   * Returns current throttle state for UI display.
   */
  getState() {
    return {
      concurrent: this.concurrentCount,
      maxConcurrent: this.config.maxConcurrentProofs,
      retriesInWindow: this.getRetriesInWindow(),
      maxRetries: this.config.maxRetriesPerSession,
      isThrottled: this.concurrentCount >= this.config.maxConcurrentProofs ||
                   this.getRetriesInWindow() >= this.config.maxRetriesPerSession,
    };
  }
}

// Global singleton instance
let globalLimiter: ProofRateLimiter | null = null;

/**
 * Gets or creates the global proof rate limiter.
 */
export function getProofRateLimiter(): ProofRateLimiter {
  if (!globalLimiter) {
    globalLimiter = new ProofRateLimiter();
  }
  return globalLimiter;
}

/**
 * Resets the global limiter (for testing or user action).
 */
export function resetProofRateLimiter(config?: Partial<ProofRateLimitConfig>): void {
  globalLimiter = new ProofRateLimiter(config);
}

/**
 * Gets the current throttle state without mutating.
 */
export function getProofThrottleState() {
  return getProofRateLimiter().getState();
}

/**
 * Clears the throttle, allowing the user to generate proofs again.
 * This should be exposed in the settings UI.
 */
export function clearProofThrottle(): void {
  getProofRateLimiter().clearThrottle();
}
