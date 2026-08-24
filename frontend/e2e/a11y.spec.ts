import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { A11Y_ALLOWLIST } from "./a11y.allowlist";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Automated accessibility audit (#472). Runs axe-core against the public,
 * unauthenticated views — the ones a crawler or a first-time visitor hits
 * without a wallet connected. Authenticated app views (`/app`, dashboard,
 * send/receive, proof flows) need a connected-wallet fixture to render
 * meaningfully and are out of scope for this pass; see wallet-smoke.spec.ts
 * for what currently exercises them.
 *
 * Severity threshold: a "critical" or "serious" impact violation (axe-core's
 * two highest severities) fails the test. "moderate"/"minor" violations are
 * still written to the report but don't fail CI — they're tracked, not
 * gating.
 */

const AUDITED_ROUTES = [
  { route: "/", name: "landing" },
  { route: "/privacy", name: "privacy" },
  { route: "/terms", name: "terms" },
  { route: "/disclaimer", name: "disclaimer" },
  { route: "/abuse-policy", name: "abuse-policy" },
  { route: "/threat-model", name: "threat-model" },
  { route: "/branding", name: "branding" },
];

const FAILING_IMPACTS = new Set(["critical", "serious"]);

const REPORT_DIR = join(__dirname, "..", "a11y-report");

function isAllowlisted(route: string, ruleId: string, target: string[]) {
  return A11Y_ALLOWLIST.some((entry) => {
    if (entry.route !== route || entry.ruleId !== ruleId) return false;
    if (!entry.nodeTarget) return true;
    return target.includes(entry.nodeTarget);
  });
}

test.describe("Accessibility audit", () => {
  test.beforeAll(() => {
    mkdirSync(REPORT_DIR, { recursive: true });
  });

  for (const { route, name } of AUDITED_ROUTES) {
    test(`${route} has no critical/serious a11y violations`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      writeFileSync(join(REPORT_DIR, `${name}.json`), JSON.stringify(results, null, 2));

      const blocking = results.violations
        .filter((v) => FAILING_IMPACTS.has(v.impact ?? ""))
        .flatMap((v) =>
          v.nodes
            .filter((node) => !isAllowlisted(route, v.id, node.target.map(String)))
            .map((node) => ({
              rule: v.id,
              impact: v.impact,
              help: v.help,
              helpUrl: v.helpUrl,
              target: node.target,
              html: node.html,
            })),
        );

      expect(
        blocking,
        `${blocking.length} critical/serious a11y violation(s) on ${route} — see ${REPORT_DIR}/${name}.json ` +
          `for the full axe report, or frontend/e2e/a11y.allowlist.ts to allowlist a justified false positive.`,
      ).toEqual([]);
    });
  }
});
