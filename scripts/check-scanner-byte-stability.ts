// @ts-nocheck
/**
 * Byte-stability check for scanner WASM rebuilds.
 *
 * Rebuilds the scanner WASM, computes its SHA-256, and compares it against
 * the pinned hash in artifacts/manifest.json. Reports identical or differing
 * with hashes; if different, explains the manifest update procedure.
 *
 * Usage:
 *   npx tsx scripts/check-scanner-byte-stability.ts
 *   npm run check:scanner-stability
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, sha256File } from "./artifact-manifest-lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCANNER = join(ROOT, "scanner");
const OUT = join(ROOT, "frontend", "public", "pkg");

function run(label, cmd, args, opts = {}) {
  console.log(`\n> ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  console.log("=== Scanner WASM Byte-Stability Check ===\n");

  // Step 1: Rebuild the scanner
  const wasmPack = process.env.WASM_PACK ?? "wasm-pack";
  const buildArgs = ["build", "--target", "web", "--out-dir", OUT];
  run(`Rebuilding scanner WASM`, wasmPack, buildArgs, { cwd: SCANNER });

  // Step 2: Load manifest
  const manifest = loadManifest();
  const scannerFiles = manifest.scanner?.files ?? {};
  const wasmEntry = scannerFiles["cryptography_bg.wasm"];

  if (!wasmEntry) {
    console.error("ERROR: cryptography_bg.wasm not found in artifact manifest");
    process.exit(1);
  }

  const expectedHash = wasmEntry.sha256;
  const wasmPath = join(ROOT, wasmEntry.path);

  if (!existsSync(wasmPath)) {
    console.error(`ERROR: Built WASM not found at ${wasmPath}`);
    process.exit(1);
  }

  // Step 3: Compute actual hash
  const actualHash = sha256File(wasmPath);
  const allowedHashes = [expectedHash, ...(wasmEntry.sha256Alternates ?? [])];

  // Step 4: Compare
  console.log(`\n--- Results ---`);
  console.log(`File:              ${wasmEntry.path}`);
  console.log(`Manifest SHA-256:  ${expectedHash}`);
  console.log(`Built SHA-256:     ${actualHash}`);

  if (allowedHashes.includes(actualHash)) {
    console.log(`\n✅ IDENTICAL — Built artifact matches the pinned manifest hash.`);
    console.log(`   Hash: ${actualHash}`);
    process.exit(0);
  }

  // Check if it matches any alternate
  const matchAlt = wasmEntry.sha256Alternates?.find((h) => h === actualHash);
  if (matchAlt) {
    console.log(`\n✅ IDENTICAL — Built artifact matches an alternate pinned hash.`);
    console.log(`   Hash: ${actualHash}`);
    process.exit(0);
  }

  console.log(`\n❌ DIFFERENT — Built artifact does NOT match the pinned manifest hash.`);
  console.log(`\nManifest expected: ${expectedHash}`);
  console.log(`Built actual:      ${actualHash}`);
  if (wasmEntry.sha256Alternates?.length > 0) {
    console.log(`Alternates tried:  ${wasmEntry.sha256Alternates.join(", ")}`);
  }

  console.log(`\n--- Manifest Update Procedure ---`);
  console.log(`To update the manifest with the new hash, run:`);
  console.log(`\n  npm run update:artifacts\n`);
  console.log(`This will update artifacts/manifest.json with the current artifact hashes.`);
  console.log(`After updating, verify with: npm run verify:artifacts -- --scanner`);
  console.log(`Then commit the updated manifest and WASM artifact together.`);

  process.exit(1);
}

main();
