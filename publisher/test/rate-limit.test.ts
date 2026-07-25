import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit.ts";

describe("RateLimiter", () => {
  it("allows requests within the limit", () => {
    const limiter = new RateLimiter(60_000, 10, 15);
    const r = limiter.consume("source-1");
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(15);
    expect(r.remaining).toBeGreaterThanOrEqual(0);
  });

  it("blocks after exhausting tokens", () => {
    const limiter = new RateLimiter(60_000, 3, 3);
    limiter.consume("abuser");
    limiter.consume("abuser");
    limiter.consume("abuser");
    const blocked = limiter.consume("abuser");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetMs).toBeGreaterThan(Date.now());
  });

  it("isolates sources from each other", () => {
    const limiter = new RateLimiter(60_000, 1, 1);
    limiter.consume("user-a");
    const blocked = limiter.consume("user-a");
    expect(blocked.allowed).toBe(false);
    const allowed = limiter.consume("user-b");
    expect(allowed.allowed).toBe(true);
  });

  it("includes standard rate-limit headers", () => {
    const limiter = new RateLimiter(60_000, 100, 120);
    const r = limiter.consume("src");
    expect(r.limit).toBe(120);
    expect(typeof r.remaining).toBe("number");
    expect(r.resetMs).toBeGreaterThan(Date.now());
  });

  it("allows burst up to burstSize", () => {
    const limiter = new RateLimiter(60_000, 5, 8);
    for (let i = 0; i < 8; i++) {
      expect(limiter.consume("burst").allowed).toBe(true);
    }
    expect(limiter.consume("burst").allowed).toBe(false);
  });

  it("does not throttle normal wallet usage", () => {
    const limiter = new RateLimiter(60_000, 120, 140);
    for (let i = 0; i < 50; i++) {
      const r = limiter.consume("wallet-normal");
      expect(r.allowed).toBe(true);
    }
  });

  it("resets tokens after window elapses", async () => {
    const limiter = new RateLimiter(2, 10, 2);
    limiter.consume("user");
    limiter.consume("user");
    const blocked = limiter.consume("user");
    expect(blocked.allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 3));
    const allowed = limiter.consume("user");
    expect(allowed.allowed).toBe(true);
  });
});
