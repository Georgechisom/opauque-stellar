/**
 * Screening policies. Under the demo policy every testnet deposit is approved
 * (`approveAll`) — this does NOT weaken the trust model (the ASP can never mint or steal),
 * only the screening. Production deployments swap in a real `Policy` via the documented
 * hook (sanctions screening, risk scoring, etc.) returning approve | reject | defer.
 */
import type { Deposit, Policy, PolicyVerdict } from "./types.ts";

/** v1 demo policy: approve every deposit. */
export const approveAll: Policy = {
  name: "approve-all",
  screen(): PolicyVerdict {
    return "approve";
  },
};

/** Allowlist stub: approve only deposits whose index is in the set, defer the rest. */
export function allowlist(indices: Iterable<number>): Policy {
  const allowed = new Set(indices);
  return {
    name: "allowlist",
    screen(deposit: Deposit): PolicyVerdict {
      return allowed.has(deposit.index) ? "approve" : "defer";
    },
  };
}

/**
 * Hook for real screening. Provide an async predicate; deposits it rejects are excluded
 * from the clean set, deposits it can't decide yet are deferred (re-evaluated next tick).
 */
export function screeningPolicy(
  name: string,
  decide: (deposit: Deposit) => Promise<PolicyVerdict> | PolicyVerdict,
): Policy {
  return { name, screen: decide };
}
