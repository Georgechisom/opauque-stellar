import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = resolve(import.meta.dirname, "../fixtures/tree-shaking-entry.ts");

/**
 * Strings that SHOULD be absent when only the crypto subpath is imported.
 * These are unique to the pool, reputation, and relayer modules.
 * If any appear in the bundle, tree-shaking failed and those modules
 * were included despite not being imported.
 */
const FORBIDDEN_PATTERNS: string[] = [
  "privacy_pool_withdraw",
  "privacy-pool",
  "reputation-verifier",
  "relayer-registry",
  "verify_reputation",
  "verify_proof_v2",
  "create_job",
];

describe("tree-shaking regression", () => {
  it("crypto-only import produces a bundle free of pool/reputation code", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "tree-shake-test-"));

    await build({
      entryPoints: [ENTRY],
      outdir,
      bundle: true,
      format: "esm",
      target: "es2022",
      platform: "node",
      external: [
        "@noble/curves",
        "@noble/hashes",
        "@stellar/stellar-sdk",
        "snarkjs",
        "circomlibjs",
        "tweetnacl",
      ],
      logLevel: "silent",
    });

    // Read the bundled output
    const outFiles = await import("node:fs/promises").then((fs) =>
      fs.readdir(outdir),
    );
    const bundleFile = outFiles.find((f) => f.endsWith(".js"));
    expect(bundleFile).toBeDefined();

    const bundle = readFileSync(join(outdir, bundleFile!), "utf8");

    // Assert forbidden patterns are absent
    const found: string[] = [];
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (bundle.includes(pattern)) {
        found.push(pattern);
      }
    }
    expect(found, `Tree-shaking regression: pool/reputation code found in crypto-only bundle: ${found.join(", ")}`).toEqual([]);
  });

  it("payments-only import from crypto subpath produces a small bundle", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "tree-shake-size-"));

    await build({
      entryPoints: [ENTRY],
      outdir,
      bundle: true,
      format: "esm",
      target: "es2022",
      platform: "node",
      external: [
        "@noble/curves",
        "@noble/hashes",
        "@stellar/stellar-sdk",
        "snarkjs",
        "circomlibjs",
        "tweetnacl",
      ],
      logLevel: "silent",
    });

    const outFiles = await import("node:fs/promises").then((fs) =>
      fs.readdir(outdir),
    );
    const bundleFile = outFiles.find((f) => f.endsWith(".js"));
    expect(bundleFile).toBeDefined();

    const bundle = readFileSync(join(outdir, bundleFile!), "utf8");
    // The bundle should contain crypto code (hex helpers, etc.)
    expect(bundle).toContain("bytesToHex");
    expect(bundle).toContain("hexToBytes");
    // But should be reasonably small (under 50KB for crypto-only)
    expect(bundle.length).toBeLessThan(50_000);
  });
});
