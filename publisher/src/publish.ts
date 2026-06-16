import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hex32ToBytes } from "./bytes.ts";
import type { RootManifest } from "./types.ts";

export function computeDatasetHash(root: string, leaves: string[]): string {
  const h = createHash("sha256");
  const count = Buffer.alloc(4);
  count.writeUInt32BE(leaves.length >>> 0, 0);
  h.update(count);
  h.update(hex32ToBytes(root));
  for (const leaf of leaves) h.update(hex32ToBytes(leaf));
  return `0x${h.digest("hex")}`;
}

export function rootManifest(opts: {
  verifierId: string;
  root: string;
  datasetHash: string;
  leaves: string[];
  generatedAt: string;
}): RootManifest {
  return {
    version: 1,
    verifierId: opts.verifierId,
    root: opts.root,
    datasetHash: opts.datasetHash,
    leafCount: opts.leaves.length,
    leaves: opts.leaves,
    generatedAt: opts.generatedAt,
  };
}

export function writeRootManifest(dataDir: string, manifest: RootManifest): void {
  const p = join(dataDir, "roots", manifest.verifierId, `${manifest.root}.json`);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(manifest, null, 2)}\n`);
}
