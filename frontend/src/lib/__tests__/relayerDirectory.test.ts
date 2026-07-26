/**
 * Relayer directory aggregation and sorting tests (#559).
 */

import { describe, it, expect } from "vitest";
import {
  feeBasisPoints,
  medianStroops,
  sortRelayerListings,
  summarizeRelayerActivity,
  type RelayerJobEvent,
  type RelayerListing,
} from "../relayerDirectory";

function listing(
  operator: string,
  overrides: {
    totalStakeStroops?: bigint;
    medianFeeStroops?: bigint | null;
    completionRate?: number | null;
    submitted?: number;
    eligible?: boolean;
  } = {},
): RelayerListing {
  return {
    operator,
    endpoint: "https://relay.example",
    x25519Pubkey: "aa".repeat(32),
    freeStakeStroops: overrides.totalStakeStroops ?? 0n,
    bondedStakeStroops: 0n,
    pendingUnstakeStroops: 0n,
    totalStakeStroops: overrides.totalStakeStroops ?? 0n,
    activity: {
      accepted: overrides.submitted ?? 0,
      submitted: overrides.submitted ?? 0,
      slashed: 0,
      completionRate:
        overrides.completionRate === undefined ? null : overrides.completionRate,
      recentFeesStroops: [],
      medianFeeStroops:
        overrides.medianFeeStroops === undefined ? null : overrides.medianFeeStroops,
      lastActiveLedger: null,
    },
    eligible: overrides.eligible ?? true,
  };
}

function job(
  kind: RelayerJobEvent["kind"],
  feeStroops: bigint,
  ledger: number,
  operator = "GAAA",
): RelayerJobEvent {
  return { kind, operator, feeStroops, ledger };
}

describe("medianStroops (#559)", () => {
  it("returns null for an empty set", () => {
    expect(medianStroops([])).toBeNull();
  });

  it("takes the middle of an odd-length set", () => {
    expect(medianStroops([300n, 100n, 200n])).toBe(200n);
  });

  it("takes the lower middle of an even-length set", () => {
    expect(medianStroops([400n, 100n, 300n, 200n])).toBe(200n);
  });

  it("does not overflow on stroop-scale values", () => {
    expect(medianStroops([10n ** 18n, 1n, 5n])).toBe(5n);
  });
});

describe("summarizeRelayerActivity (#559)", () => {
  it("reports no history rather than a perfect record for a new relayer", () => {
    const summary = summarizeRelayerActivity([]);
    expect(summary.completionRate).toBeNull();
    expect(summary.medianFeeStroops).toBeNull();
    expect(summary.lastActiveLedger).toBeNull();
  });

  it("counts accepted, submitted, and slashed jobs", () => {
    const summary = summarizeRelayerActivity([
      job("accepted", 100n, 10),
      job("submitted", 100n, 11),
      job("accepted", 200n, 12),
      job("slashed", 200n, 20),
    ]);
    expect(summary.accepted).toBe(2);
    expect(summary.submitted).toBe(1);
    expect(summary.slashed).toBe(1);
  });

  it("computes completion over resolved jobs only", () => {
    // One submitted, one slashed, one still in flight: 50%, not 33%.
    const summary = summarizeRelayerActivity([
      job("accepted", 100n, 10),
      job("accepted", 100n, 11),
      job("accepted", 100n, 12),
      job("submitted", 100n, 13),
      job("slashed", 100n, 14),
    ]);
    expect(summary.completionRate).toBe(0.5);
  });

  it("derives the fee only from jobs that were actually paid", () => {
    const summary = summarizeRelayerActivity([
      job("accepted", 999_999n, 10), // never completed — must not set the fee
      job("submitted", 100n, 11),
      job("submitted", 300n, 12),
      job("submitted", 200n, 13),
    ]);
    expect(summary.medianFeeStroops).toBe(200n);
    expect(summary.recentFeesStroops).not.toContain(999_999n);
  });

  it("keeps recent fees newest-first and bounded", () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      job("submitted", BigInt(i), i + 1),
    );
    const summary = summarizeRelayerActivity(events);
    expect(summary.recentFeesStroops).toHaveLength(10);
    expect(summary.recentFeesStroops[0]).toBe(24n);
  });

  it("tracks the latest ledger the relayer appeared in", () => {
    const summary = summarizeRelayerActivity([
      job("submitted", 1n, 500),
      job("accepted", 1n, 900),
      job("submitted", 1n, 700),
    ]);
    expect(summary.lastActiveLedger).toBe(900);
  });
});

describe("sortRelayerListings (#559)", () => {
  const cheap = listing("GBBB", { medianFeeStroops: 100n, totalStakeStroops: 50n });
  const pricey = listing("GCCC", { medianFeeStroops: 900n, totalStakeStroops: 5_000n });
  const unknown = listing("GDDD", { medianFeeStroops: null, totalStakeStroops: 500n });
  const all = [pricey, unknown, cheap];

  it("sorts by fee ascending", () => {
    expect(sortRelayerListings(all, "fee", "asc").map((l) => l.operator)).toEqual([
      "GBBB",
      "GCCC",
      "GDDD",
    ]);
  });

  it("sorts by fee descending", () => {
    expect(sortRelayerListings(all, "fee", "desc").map((l) => l.operator)).toEqual([
      "GCCC",
      "GBBB",
      "GDDD",
    ]);
  });

  it("never lets a relayer with no fee history win the cheapest slot", () => {
    for (const direction of ["asc", "desc"] as const) {
      expect(sortRelayerListings(all, "fee", direction).at(-1)?.operator).toBe("GDDD");
    }
  });

  it("sorts by stake in both directions", () => {
    expect(sortRelayerListings(all, "stake", "desc").map((l) => l.operator)).toEqual([
      "GCCC",
      "GDDD",
      "GBBB",
    ]);
    expect(sortRelayerListings(all, "stake", "asc").map((l) => l.operator)).toEqual([
      "GBBB",
      "GDDD",
      "GCCC",
    ]);
  });

  it("compares stake as bigint, not as a lossy number", () => {
    const huge = listing("GAAA", { totalStakeStroops: 9_007_199_254_740_993n });
    const slightlySmaller = listing("GZZZ", { totalStakeStroops: 9_007_199_254_740_992n });
    expect(
      sortRelayerListings([slightlySmaller, huge], "stake", "desc")[0].operator,
    ).toBe("GAAA");
  });

  it("sorts by completion rate, keeping unknowns last", () => {
    const reliable = listing("GBBB", { completionRate: 1 });
    const flaky = listing("GCCC", { completionRate: 0.4 });
    const untested = listing("GDDD", { completionRate: null });
    expect(
      sortRelayerListings([flaky, untested, reliable], "completion", "desc").map(
        (l) => l.operator,
      ),
    ).toEqual(["GBBB", "GCCC", "GDDD"]);
  });

  it("sorts by completed job count", () => {
    const busy = listing("GBBB", { submitted: 40 });
    const quiet = listing("GCCC", { submitted: 2 });
    expect(sortRelayerListings([quiet, busy], "jobs", "desc")[0].operator).toBe("GBBB");
  });

  it("breaks ties deterministically so the table does not reshuffle", () => {
    const a = listing("GAAA", { totalStakeStroops: 100n });
    const b = listing("GBBB", { totalStakeStroops: 100n });
    expect(sortRelayerListings([b, a], "stake", "desc").map((l) => l.operator)).toEqual([
      "GAAA",
      "GBBB",
    ]);
    expect(sortRelayerListings([a, b], "stake", "desc").map((l) => l.operator)).toEqual([
      "GAAA",
      "GBBB",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [pricey, cheap];
    sortRelayerListings(input, "fee", "asc");
    expect(input.map((l) => l.operator)).toEqual(["GCCC", "GBBB"]);
  });
});

describe("feeBasisPoints (#559)", () => {
  it("expresses a fee as a share of the withdrawal", () => {
    // 0.1 XLM fee on a 10 XLM withdrawal = 100 bps.
    expect(feeBasisPoints(1_000_000n, 100_000_000n)).toBe(100);
  });

  it("returns null when either side is unknown", () => {
    expect(feeBasisPoints(null, 100n)).toBeNull();
    expect(feeBasisPoints(100n, 0n)).toBeNull();
  });
});
