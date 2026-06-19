/**
 * Live testnet pool reads, gated by OPAQUE_E2E_TESTNET=1. Exercises the on-chain
 * reconstruction path: deposit count, published roots, and rebuilding the
 * commitment leaves from Deposit/Withdraw events.
 *
 *   OPAQUE_E2E_TESTNET=1 npm test
 */
import { describe, it, expect } from "vitest";
import { OpaqueClient } from "../../src/index";

const LIVE = process.env.OPAQUE_E2E_TESTNET === "1";
const SOURCE = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";

describe.skipIf(!LIVE)("privacy pool reads against live testnet", () => {
  const client = new OpaqueClient({ network: "testnet" });

  it("reads the deposit count and published roots", async () => {
    const count = await client.pool.getDepositCount({ source: SOURCE });
    expect(count).toBeGreaterThanOrEqual(0);

    const roots = await client.pool.getRoots({ source: SOURCE });
    // Roots are either published 32-byte values or null (nothing published yet).
    for (const root of [roots.state, roots.asp]) {
      if (root) expect(root.length).toBe(32);
    }
  }, 60_000);

  it("reconstructs the commitment leaves from on-chain events", async () => {
    const { stateLeaves, depositIndices } =
      await client.contracts.privacyPool.reconstructState({
        startLedger: client.config.startLedger,
      });
    expect(Array.isArray(stateLeaves)).toBe(true);
    expect(Array.isArray(depositIndices)).toBe(true);
    // every deposit index addresses a real state leaf
    expect(depositIndices.length).toBeLessThanOrEqual(stateLeaves.length);
    for (const i of depositIndices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(stateLeaves.length);
    }
  }, 90_000);
});
