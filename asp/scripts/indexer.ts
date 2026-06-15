// @ts-nocheck
/**
 * ASP indexer CLI.
 *   npm run indexer:once   — single reconcile pass (used by the headless smoke)
 *   npm run indexer        — loop every ASP_INTERVAL_MS
 *
 * Config (env / .env): STELLAR_RPC_URL, ASP_SECRET (S... authority seed), ASP_INTERVAL_MS,
 * ASP_CONFIRMATIONS, optional IPFS_API_URL. Pool id + scope are resolved from
 * deployments/v1/testnet.json. Never run in CI (it sends live transactions).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarChainAdapter } from "../src/chains/stellar.ts";
import { FileStore } from "../src/store.ts";
import { approveAll } from "../src/policy.ts";
import { runPoolTick } from "../src/engine.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

function loadConfig() {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "deployments", "v1", "testnet.json"), "utf8"),
  );
  const poolId = manifest.contracts?.privacyPool?.id;
  const scope = manifest.wiring?.privacyPool?.scope ?? 1;
  if (!poolId) throw new Error("privacyPool not deployed (deployments/v1/testnet.json)");

  const secret = process.env.ASP_SECRET?.trim();
  if (!secret) throw new Error("set ASP_SECRET (the ASP authority S... seed)");

  return {
    poolId,
    scope,
    authority: Keypair.fromSecret(secret),
    rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    intervalMs: Number(process.env.ASP_INTERVAL_MS ?? 15000),
    confirmations: Number(process.env.ASP_CONFIRMATIONS ?? 1),
    dataDir: join(__dirname, "..", "data"),
  };
}

async function tick(cfg, adapter, store) {
  const res = await runPoolTick({
    poolId: cfg.poolId,
    scope: cfg.scope,
    adapter,
    store,
    policy: approveAll,
    dataDir: cfg.dataDir,
    confirmations: cfg.confirmations,
  });
  const when = new Date().toISOString();
  console.log(
    `[${when}] approved=${res.approvedCount} (+${res.newlyApproved}) root=${res.localRoot.slice(0, 14)}… ` +
      `${res.published ? "PUBLISHED" : "in-sync"}`,
  );
  return res;
}

async function main() {
  const once = process.argv.includes("--once");
  const cfg = loadConfig();
  const adapter = new StellarChainAdapter({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    poolId: cfg.poolId,
    scope: cfg.scope,
    authority: cfg.authority,
    confirmations: cfg.confirmations,
  });
  const store = new FileStore(cfg.dataDir);

  if (once) {
    await tick(cfg, adapter, store);
    return;
  }
  console.log(`ASP indexer loop every ${cfg.intervalMs}ms for pool ${cfg.poolId}`);
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      await tick(cfg, adapter, store);
    } catch (e) {
      console.error(`tick error: ${e?.message ?? e}`);
    }
    await new Promise((r) => setTimeout(r, cfg.intervalMs));
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
