/**
 * Pluggable inclusion policy engine. Operators register named policies that receive
 * deposit context and return an auditable decision. The engine composes policies via
 * a configurable strategy (e.g., "any approve wins", "all must approve", "first decides").
 *
 * Ships with the approve-all reference policy as the default so operators who do not
 * need custom screening get working behaviour out of the box.
 */
import type { Deposit, Policy, PolicyVerdict } from "./types.ts";

export interface PolicyDecision {
  policy: string;
  deposit: Deposit;
  verdict: PolicyVerdict;
  reason?: string;
  timestamp: string;
}

export interface PolicyEngineConfig {
  /** Ordered list of policies to evaluate. */
  policies: Policy[];
  /**
   * Composition strategy:
   * - "first-decides"   — first non-defer verdict wins (default, fast-path)
   * - "any-approve"     — approve if any policy approves
   * - "all-must-approve" — approve only if every policy approves
   */
  strategy?: "first-decides" | "any-approve" | "all-must-approve";
  /** Optional callback invoked for every decision (audit log, metrics, etc.). */
  onDecision?: (decision: PolicyDecision) => void;
}

/**
 * A composable policy engine that evaluates deposits against a chain of policies.
 */
export class PolicyEngine {
  readonly policies: Policy[];
  private strategy: PolicyEngineConfig["strategy"];
  private onDecision?: (decision: PolicyDecision) => void;

  constructor(config: PolicyEngineConfig) {
    if (config.policies.length === 0) {
      throw new Error("PolicyEngine requires at least one policy");
    }
    this.policies = [...config.policies];
    this.strategy = config.strategy ?? "first-decides";
    this.onDecision = config.onDecision;
  }

  /** Human-readable engine descriptor. */
  get name(): string {
    return `policy-engine(${this.policies.map((p) => p.name).join(",")})`;
  }

  async screen(deposit: Deposit): Promise<PolicyVerdict> {
    const results: PolicyDecision[] = [];
    const ts = new Date().toISOString();

    for (const policy of this.policies) {
      const verdict = await policy.screen(deposit);
      const decision: PolicyDecision = { policy: policy.name, deposit, verdict, timestamp: ts };
      results.push(decision);
      if (this.onDecision) this.onDecision(decision);
    }

    switch (this.strategy) {
      case "any-approve":
        return results.some((r) => r.verdict === "approve") ? "approve" : "reject";
      case "all-must-approve":
        return results.every((r) => r.verdict === "approve") ? "approve" : "reject";
      case "first-decides":
      default:
        for (const r of results) {
          if (r.verdict !== "defer") return r.verdict;
        }
        return "defer";
    }
  }
}
