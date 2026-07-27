/**
 * Relayer comparison table (#559).
 *
 * Lists every registered relayer with the numbers that matter before you hand one an
 * encrypted withdrawal: what they have historically charged, how much stake they have
 * at risk, and how often they finished the jobs they accepted. Columns sort, and the
 * chosen operator is bound into the withdrawal proof by the caller.
 */

import { useCallback, useMemo, useState } from "react";
import {
  feeBasisPoints,
  sortRelayerListings,
  type RelayerListing,
  type RelayerSortKey,
  type SortDirection,
} from "../lib/relayerDirectory";

const STROOPS_PER_XLM = 10_000_000n;

function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = (stroops % STROOPS_PER_XLM)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

const COLUMNS: Array<{ key: RelayerSortKey; label: string; hint: string }> = [
  { key: "fee", label: "Fee", hint: "Median fee paid on this relayer's recent jobs" },
  { key: "stake", label: "Stake", hint: "Free + bonded stake the relayer has at risk" },
  { key: "completion", label: "Completed", hint: "Submitted vs. slashed on accepted jobs" },
  { key: "jobs", label: "Jobs", hint: "Withdrawals this relayer has submitted" },
];

type Props = {
  listings: RelayerListing[];
  selected: string | null;
  onSelect: (operator: string | null) => void;
  onRefresh: () => void;
  loading: boolean;
  error: string | null;
  /** Amount being withdrawn, used to express fees in basis points. */
  withdrawnStroops?: bigint;
};

export function RelayerComparison({
  listings,
  selected,
  onSelect,
  onRefresh,
  loading,
  error,
  withdrawnStroops = 0n,
}: Props) {
  const [sortKey, setSortKey] = useState<RelayerSortKey>("stake");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const sorted = useMemo(
    () => sortRelayerListings(listings, sortKey, direction),
    [listings, sortKey, direction],
  );

  const toggleSort = useCallback(
    (key: RelayerSortKey) => {
      if (key === sortKey) {
        setDirection((d) => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      // Cheapest-first and most-reliable-first are the useful defaults.
      setDirection(key === "fee" ? "asc" : "desc");
    },
    [sortKey],
  );

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-white">Choose a relayer</h4>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-mist/60">
            Live registry state. Picking one binds that operator into your withdrawal
            proof, so only they can submit it. Leave it unset to let staked relayers bid
            and pick the winner afterwards.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="min-h-9 shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-glow hover:text-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-error/30 bg-error/10 p-3 text-xs text-error">
          {error}
        </p>
      )}

      {!error && sorted.length === 0 && (
        <p className="mt-3 text-xs text-mist/50">
          {loading
            ? "Reading the relayer registry…"
            : "No relayers are registered on this network yet."}
        </p>
      )}

      {sorted.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
            <thead>
              <tr className="text-mist/50">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Relayer
                </th>
                {COLUMNS.map((column) => {
                  const active = sortKey === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className="py-2 pr-3 font-medium"
                      aria-sort={
                        active
                          ? direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        title={column.hint}
                        className={`inline-flex items-center gap-1 rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow ${
                          active ? "text-glow" : ""
                        }`}
                      >
                        {column.label}
                        <span aria-hidden>
                          {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((listing) => {
                const isSelected = selected === listing.operator;
                const bps = feeBasisPoints(
                  listing.activity.medianFeeStroops,
                  withdrawnStroops,
                );
                return (
                  <tr
                    key={listing.operator}
                    className={`border-t border-ink-800 transition-colors ${
                      isSelected ? "bg-black/40 text-white" : "text-mist"
                    }`}
                  >
                    <td className="py-2 pr-3">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="relayer-directory"
                          checked={isSelected}
                          onChange={() => onSelect(listing.operator)}
                          disabled={!listing.eligible}
                          className="accent-glow"
                        />
                        <span className="font-mono">{shortAddress(listing.operator)}</span>
                        {!listing.eligible && (
                          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                            under-staked
                          </span>
                        )}
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      {listing.activity.medianFeeStroops === null ? (
                        <span className="text-mist/40">no history</span>
                      ) : (
                        <>
                          {formatXlm(listing.activity.medianFeeStroops)} XLM
                          {bps !== null && (
                            <span className="ml-1 text-mist/40">({bps} bps)</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3">{formatXlm(listing.totalStakeStroops)} XLM</td>
                    <td className="py-2 pr-3">
                      {listing.activity.completionRate === null ? (
                        <span className="text-mist/40">no history</span>
                      ) : (
                        `${Math.round(listing.activity.completionRate * 100)}%`
                      )}
                    </td>
                    <td className="py-2 pr-3">{listing.activity.submitted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="mt-3 min-h-9 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow"
        >
          Clear selection (use open bidding)
        </button>
      )}
    </div>
  );
}
