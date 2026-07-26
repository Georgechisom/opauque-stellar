import { describe, it, expect } from "vitest";
import { poolSizeFromCoreCount, defaultPoolSize } from "../../src/prove/index";

describe("proof worker pool sizing", () => {
  it("defaults to cores minus one", () => {
    expect(poolSizeFromCoreCount(8)).toBe(7);
    expect(poolSizeFromCoreCount(4)).toBe(3);
  });

  it("never goes below 1, even on a single-core or unknown-core machine", () => {
    expect(poolSizeFromCoreCount(1)).toBe(1);
    expect(poolSizeFromCoreCount(0)).toBe(1);
    expect(poolSizeFromCoreCount(-1)).toBe(1);
    expect(poolSizeFromCoreCount(NaN)).toBe(1);
  });

  it("floors fractional core counts before subtracting", () => {
    expect(poolSizeFromCoreCount(4.9)).toBe(3);
  });

  it("detects a real pool size for the current runtime", async () => {
    const size = await defaultPoolSize();
    expect(size).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(size)).toBe(true);
  });
});
