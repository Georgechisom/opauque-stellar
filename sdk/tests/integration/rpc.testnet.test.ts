/**
 * Network-gated integration test. Runs only when OPAQUE_E2E_TESTNET=1 so the
 * default unit run stays offline and fast. Exercises the real RPC/Horizon
 * plumbing against Stellar testnet via the SDK's resolved config.
 *
 *   OPAQUE_E2E_TESTNET=1 npm test
 */
import { describe, it, expect } from "vitest";
import { resolveConfig, RpcClient } from "../../src/index";

const LIVE = process.env.OPAQUE_E2E_TESTNET === "1";
const DEPLOYER = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";

describe.skipIf(!LIVE)("RpcClient against live testnet", () => {
  it("resolves testnet config and reads an account from Horizon", async () => {
    const config = resolveConfig({ network: "testnet" });
    const client = new RpcClient({ config });
    const account = await client.horizon().loadAccount(DEPLOYER);
    expect(account.accountId()).toBe(DEPLOYER);
  });

  it("reaches the Soroban RPC health endpoint", async () => {
    const config = resolveConfig({ network: "testnet" });
    const client = new RpcClient({ config });
    const health = await client.server.getHealth();
    expect(health.status).toBe("healthy");
  });
});
