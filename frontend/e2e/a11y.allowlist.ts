/**
 * Accessibility audit false-positive allowlist (#472).
 *
 * Every entry here suppresses a specific axe-core rule on a specific route
 * and MUST carry a `justification` explaining why it's a false positive
 * (or an accepted, tracked exception) rather than a real violation. Do not
 * add an entry just to make the audit pass — fix the underlying issue
 * instead unless there's a genuine reason it can't be fixed here.
 *
 * `route` matches the `route` used in e2e/a11y.spec.ts's AUDITED_ROUTES.
 * Leave `nodeTarget` unset to allowlist the rule for the whole route.
 */
export interface A11yAllowlistEntry {
  route: string;
  ruleId: string;
  /** CSS selector(s) axe reported for the specific violating node, from the report's `target` array. Omit to allowlist the whole route for this rule. */
  nodeTarget?: string;
  justification: string;
}

export const A11Y_ALLOWLIST: A11yAllowlistEntry[] = [];
