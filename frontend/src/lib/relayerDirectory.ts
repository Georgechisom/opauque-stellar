/**
 * Live relayer registry directory (#559).
 *
 * Withdrawals used to hand the user whichever relayer the stake-weighted lottery
 * picked, with no way to see who else was available, what they charge, or how much
 * stake they actually have at risk. This module assembles a comparable view of the
 * market straight from chain state:
 *
 *  - Operators are discovered from `RelayerRegistered` events.
 *  - Stake comes from a read-only `get_relayer` simulation per operator, so the
 *    numbers are current registry state rather than whatever a bid claims.
 *  - Fee and reliability come from the registry's own job events: what each operator
 *    was actually paid (`JobSubmitted`) versus how often they were slashed
 *    (`JobSlashed`) after accepting.
 *
 * Nothing here trusts the gateway. A relayer that advertises a low fee but has no
 * stake, or a history of slashing, is visible as such before the user commits.
 */

import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { getRelayerConfig } from "../contracts/relayerConfig";
import { getActiveManifest } from "../contracts/deploymentManifest";
import { getNetworkPassphrase } from "./chain";
import { getSorobanServer } from "./stellar";

/** How far back to scan when the manifest has no deployment ledger. */
const EVENT_LOOKBACK = 16_000;
/** Page cap; the registry emits far fewer events than the pool. */
const MAX_EVENT_PAGES = 60;
/** Keep the fee history bounded — only recent jobs describe today's market. */
const RECENT_FEE_WINDOW = 10;

export type RelayerJobEventKind = "accepted" | "submitted" | "slashed";

/** One registry job event, flattened to the fields the directory cares about. */
export type RelayerJobEvent = {
  kind: RelayerJobEventKind;
  operator: string;
  feeStroops: bigint;
  ledger: number;
};

export type RelayerActivity = {
  accepted: number;
  submitted: number;
  slashed: number;
  /**
   * Share of resolved jobs that were submitted rather than slashed, in `[0, 1]`.
   * `null` when the operator has no resolved job yet — an unknown record is not
   * the same as a perfect one, and the UI must not present it as such.
   */
  completionRate: number | null;
  /** Fees actually paid on this operator's recent jobs, newest first. */
  recentFeesStroops: bigint[];
  /** Median of `recentFeesStroops`; `null` when they have never been paid. */
  medianFeeStroops: bigint | null;
  /** Latest ledger this operator appeared in, for a freshness hint. */
  lastActiveLedger: number | null;
};

export type RelayerListing = {
  operator: string;
  endpoint: string;
  x25519Pubkey: string;
  freeStakeStroops: bigint;
  bondedStakeStroops: bigint;
  pendingUnstakeStroops: bigint;
  /** Free + bonded. What the operator has at risk overall. */
  totalStakeStroops: bigint;
  activity: RelayerActivity;
  /** True when free stake still covers the registry's minimum bond. */
  eligible: boolean;
};

// ─── Pure helpers (unit-tested without a network) ───────────────────────────

/** Median of a bigint list. Even-length lists take the lower-middle value. */
export function medianStroops(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Fold a relayer's job events into comparable statistics.
 *
 * `accepted` counts every job taken on; `completionRate` divides submissions by
 * *resolved* jobs (submitted + slashed) so a job still in flight neither rewards
 * nor punishes the operator.
 */
export function summarizeRelayerActivity(
  events: readonly RelayerJobEvent[],
): RelayerActivity {
  let accepted = 0;
  let submitted = 0;
  let slashed = 0;
  let lastActiveLedger: number | null = null;
  const paidFees: Array<{ fee: bigint; ledger: number }> = [];

  for (const event of events) {
    if (event.kind === "accepted") accepted += 1;
    if (event.kind === "slashed") slashed += 1;
    if (event.kind === "submitted") {
      submitted += 1;
      paidFees.push({ fee: event.feeStroops, ledger: event.ledger });
    }
    if (lastActiveLedger === null || event.ledger > lastActiveLedger) {
      lastActiveLedger = event.ledger;
    }
  }

  const resolved = submitted + slashed;
  const recentFeesStroops = paidFees
    .sort((a, b) => b.ledger - a.ledger)
    .slice(0, RECENT_FEE_WINDOW)
    .map((entry) => entry.fee);

  return {
    accepted,
    submitted,
    slashed,
    completionRate: resolved === 0 ? null : submitted / resolved,
    recentFeesStroops,
    medianFeeStroops: medianStroops(recentFeesStroops),
    lastActiveLedger,
  };
}

export type RelayerSortKey = "fee" | "stake" | "completion" | "jobs";
export type SortDirection = "asc" | "desc";

function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort listings for the comparison table.
 *
 * Listings with no data for the active key always sort last, in both directions:
 * a relayer that has never been paid must not win "cheapest", and one that has never
 * completed a job must not win "most reliable".
 */
export function sortRelayerListings(
  listings: readonly RelayerListing[],
  key: RelayerSortKey,
  direction: SortDirection = "asc",
): RelayerListing[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...listings].sort((a, b) => {
    switch (key) {
      case "fee": {
        const aFee = a.activity.medianFeeStroops;
        const bFee = b.activity.medianFeeStroops;
        if (aFee === null || bFee === null) {
          if (aFee === bFee) return compareOperator(a, b);
          return aFee === null ? 1 : -1;
        }
        return compareBigint(aFee, bFee) * sign || compareOperator(a, b);
      }
      case "stake":
        return (
          compareBigint(a.totalStakeStroops, b.totalStakeStroops) * sign ||
          compareOperator(a, b)
        );
      case "completion": {
        const aRate = a.activity.completionRate;
        const bRate = b.activity.completionRate;
        if (aRate === null || bRate === null) {
          if (aRate === bRate) return compareOperator(a, b);
          return aRate === null ? 1 : -1;
        }
        return (aRate - bRate) * sign || compareOperator(a, b);
      }
      case "jobs":
        return (
          (a.activity.submitted - b.activity.submitted) * sign ||
          compareOperator(a, b)
        );
    }
  });
}

/** Deterministic tiebreak so the table never reshuffles between refreshes. */
function compareOperator(a: RelayerListing, b: RelayerListing): number {
  return a.operator.localeCompare(b.operator);
}

/** Fee as a share of the amount being withdrawn, for an at-a-glance comparison. */
export function feeBasisPoints(
  feeStroops: bigint | null,
  withdrawnStroops: bigint,
): number | null {
  if (feeStroops === null || withdrawnStroops <= 0n) return null;
  return Number((feeStroops * 10_000n) / withdrawnStroops);
}

// ─── Chain reads ────────────────────────────────────────────────────────────

type NativeRelayerRecord = {
  operator?: string;
  endpoint?: string;
  free_stake: bigint | number | string;
  bonded_stake?: bigint | number | string;
  pending_unstake?: bigint | number | string;
  x25519_pubkey: Uint8Array | number[];
};

function toBigInt(value: bigint | number | string | undefined): bigint {
  if (value === undefined || value === null) return 0n;
  return BigInt(value);
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function topicFilter(name: string): string {
  return xdr.ScVal.scvSymbol(name).toXDR("base64");
}

function parseOldestLedgerFromRangeError(err: unknown): number | null {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown })?.message === "string"
          ? ((err as { message: string }).message)
          : "";
  const match = /ledger range:\s*(\d+)\s*-\s*(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

async function registryEventStartLedger(server: rpc.Server): Promise<number> {
  const latest = (await server.getLatestLedger()).sequence;
  const deployedAt = getActiveManifest()?.deploymentLedger;
  let start =
    deployedAt && deployedAt > 0 ? deployedAt : Math.max(1, latest - EVENT_LOOKBACK);
  try {
    const oldest = Number((await server.getHealth()).oldestLedger);
    if (start < oldest) start = oldest;
  } catch {
    /* health endpoint unavailable — the range error below still corrects us */
  }
  return start;
}

/**
 * Page through one topic's events. Soroban returns many empty pages before the ones
 * holding events, so we follow the cursor until it stops advancing rather than
 * stopping at the first short page.
 */
async function readRegistryEvents(
  registryId: string,
  topic: string,
  onEvent: (data: unknown[], ledger: number) => void,
): Promise<void> {
  const server = getSorobanServer();
  let startLedger = await registryEventStartLedger(server);
  const filters = [
    { type: "contract" as const, contractIds: [registryId], topics: [[topic, "*"]] },
  ];

  let cursor: string | undefined;
  let prevCursor: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    let res: rpc.Api.GetEventsResponse;
    try {
      const req: rpc.Server.GetEventsRequest = cursor
        ? { cursor, filters, limit: 100 }
        : { startLedger, filters, limit: 100 };
      res = await server.getEvents(req);
    } catch (err) {
      const oldest = parseOldestLedgerFromRangeError(err);
      if (!cursor && oldest != null && startLedger < oldest) {
        startLedger = oldest;
        res = await server.getEvents({ startLedger, filters, limit: 100 });
      } else {
        throw err;
      }
    }
    for (const event of res.events ?? []) {
      try {
        const native = scValToNative(event.value);
        onEvent(Array.isArray(native) ? native : [native], Number(event.ledger));
      } catch {
        /* skip an event whose payload we cannot decode */
      }
    }
    cursor = res.cursor;
    if (!cursor || cursor === prevCursor) break;
    prevCursor = cursor;
  }
}

/** Read one operator's current registry record via read-only simulation. */
async function readRelayerRecord(
  registryId: string,
  operator: string,
  sourcePublicKey: string,
): Promise<NativeRelayerRecord | null> {
  const server = getSorobanServer();
  try {
    const account = await server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        new Contract(registryId).call(
          "get_relayer",
          nativeToScVal(operator, { type: "address" }),
        ),
      )
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) return null;
    return scValToNative(sim.result.retval) as NativeRelayerRecord;
  } catch {
    // A deregistered or unreadable operator is simply left out of the directory.
    return null;
  }
}

/**
 * Build the live relayer directory.
 *
 * `caller` is any funded account used as the simulation source; it is never charged
 * and never signs. Operators whose record can no longer be read are dropped.
 */
export async function fetchRelayerDirectory(opts: {
  caller: string;
}): Promise<RelayerListing[]> {
  const cfg = getRelayerConfig();
  if (!cfg) return [];

  const operators = new Set<string>();
  const jobEvents: RelayerJobEvent[] = [];

  await readRegistryEvents(cfg.registryId, topicFilter("RelayerRegistered"), (data) => {
    // (operator, stake)
    const operator = data[0];
    if (typeof operator === "string") operators.add(operator);
  });

  const jobTopics: Array<[string, RelayerJobEventKind]> = [
    ["JobAccepted", "accepted"],
    ["JobSubmitted", "submitted"],
    ["JobSlashed", "slashed"],
  ];
  for (const [name, kind] of jobTopics) {
    await readRegistryEvents(cfg.registryId, topicFilter(name), (data, ledger) => {
      // (job_id, operator, fee)
      const operator = data[1];
      if (typeof operator !== "string") return;
      operators.add(operator);
      jobEvents.push({
        kind,
        operator,
        feeStroops: toBigInt(data[2] as bigint | number | string | undefined),
        ledger,
      });
    });
  }

  const records = await Promise.all(
    [...operators].map(async (operator) => ({
      operator,
      record: await readRelayerRecord(cfg.registryId, operator, opts.caller),
    })),
  );

  const listings: RelayerListing[] = [];
  for (const { operator, record } of records) {
    if (!record) continue;
    const freeStakeStroops = toBigInt(record.free_stake);
    const bondedStakeStroops = toBigInt(record.bonded_stake);
    listings.push({
      operator,
      endpoint: record.endpoint?.trim() ?? "",
      x25519Pubkey: bytesToHex(record.x25519_pubkey),
      freeStakeStroops,
      bondedStakeStroops,
      pendingUnstakeStroops: toBigInt(record.pending_unstake),
      totalStakeStroops: freeStakeStroops + bondedStakeStroops,
      activity: summarizeRelayerActivity(
        jobEvents.filter((event) => event.operator === operator),
      ),
      eligible: freeStakeStroops >= cfg.minimumStake,
    });
  }

  return sortRelayerListings(listings, "stake", "desc");
}
