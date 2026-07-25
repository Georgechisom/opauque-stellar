interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly burstSize: number;
  private lastCleanup = Date.now();

  constructor(windowMs = 60_000, maxRequests = 120, burstSize = 20) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.burstSize = burstSize;
  }

  consume(source: string): RateLimitResult {
    const now = Date.now();
    this.maybeCleanup(now);

    let bucket = this.buckets.get(source);
    if (!bucket) {
      bucket = { tokens: this.maxRequests, lastRefill: now };
      this.buckets.set(source, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    if (elapsed >= this.windowMs) {
      bucket.tokens = this.maxRequests;
      bucket.lastRefill = now;
    } else {
      const refill = (elapsed / this.windowMs) * this.maxRequests;
      bucket.tokens = Math.min(this.maxRequests, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    const effectiveLimit = this.maxRequests + this.burstSize;
    const resetMs = bucket.lastRefill + this.windowMs;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        limit: effectiveLimit,
        remaining: Math.floor(bucket.tokens),
        resetMs,
      };
    }

    return {
      allowed: false,
      limit: effectiveLimit,
      remaining: 0,
      resetMs,
    };
  }

  private maybeCleanup(now: number): void {
    if (now - this.lastCleanup < this.windowMs * 2) return;
    this.lastCleanup = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > this.windowMs * 3) {
        this.buckets.delete(key);
      }
    }
  }
}

export function createRateLimiterFromEnv(): RateLimiter {
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 120);
  const burstSize = Number(process.env.RATE_LIMIT_BURST ?? 20);
  return new RateLimiter(windowMs, maxRequests, burstSize);
}
