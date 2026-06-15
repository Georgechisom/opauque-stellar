/**
 * Manifest publishing. The set manifest is self-authenticating — anyone can recompute the
 * Merkle root from `labels` and check it equals the on-chain `aspRoot` — so IPFS pinning
 * is optional and the file store is purely a convenience/cache.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SetManifest } from "./types.ts";

/**
 * Deterministic 32-byte dataset hash binding a published root to its exact leaf set.
 * Stored on-chain alongside the root (the contract treats it as opaque). sha256 over the
 * ordered label list keeps it reproducible by any verifier.
 */
export function computeDatasetHash(labels: string[]): string {
  const h = createHash("sha256");
  for (const l of labels) h.update(l).update("\n");
  return "0x" + h.digest("hex");
}

/** Write `data/sets/<poolId>/<root>.json` and return its path. */
export function writeManifest(dataDir: string, manifest: SetManifest): string {
  const dir = join(dataDir, "sets", manifest.poolId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${manifest.root}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  // Also write a `latest.json` pointer for convenience.
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}
