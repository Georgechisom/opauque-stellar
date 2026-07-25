import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit.ts";

describe("RateLimiter", () => {
  it("allows requests within the limit", () => {
    const limiter = new RateLimiter(60_000, 10, 5);
    const r = limiter.consume("source-1");
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(15);
    expect(r.remaining).toBeGreaterThanOrEqual(0);
  });

  it("blocks after exhausting tokens", () => {
    const limiter = new RateLimiter(60_000, 3, 0);
    limiter.consume("abuser");
    limiter.consume("abuser");
    limiter.consume("abuser");
    const blocked = limiter.consume("abuser");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(Date.now());
  });

  it("isolates sources from each other", () => {
    const limiter = new RateLimiter(60_000, 1, 0);
    limiter.consume("user-a");
    const blocked = limiter.consume("user-a");
    expect(blocked.allowed).toBe(false);
    const allowed = limiter.consume("user-b");
    expect(allowed.allowed).toBe(true);
  });

  it("includes standard rate-limit headers", () => {
    const limiter = new RateLimiter(60_000, 100, 20);
    const r = limiter.consume("src");
    expect(r.limit).toBe(120);
    expect(typeof r.remaining).toBe("number");
    expect(r.resetMs).toBeGreaterThan(Date.now());
  });

  it("allows burst above window limit", () => {
    const limiter = new RateLimiter(60_000, 5, 3);
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume("burst").allowed).toBe(true);
    }
    expect(limiter.consume("burst").allowed).toBe(true);
    expect(limiter.consume("burst").allowed).toBe(true);
    expect(limiter.consume("burst").allowed).toBe(false);
  });

  it("does not throttle normal wallet usage", () => {
    const limiter = new RateLimiter(60_000, 120, 20);
    for (let i = 0; i < 50; i++) {
      const r = limiter.consume("wallet-normal");
      expect(r.allowed).toBe(true);
    }
  });

  it("cleanups stale entries", () => {
    const limiter = new RateLimiter(1, 10, 0);
    limiter.consume("stale-source");
    for (let i = 0; i < 5; i++) limiter.consume("stale-source");
    const blocked = limiter.consume("stale-source");
    expect(blocked.allowed).toBe(false);
  });
});
