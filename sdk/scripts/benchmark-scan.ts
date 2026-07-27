#!/usr/bin/env node
/**
 * Large-scale scanner benchmark (#604).
 *
 * Generates a deterministic synthetic fixture of announcements (default
 * 120,000 — comfortably above the 100k floor in the issue) and benchmarks
 * `scanAnnouncementsViewOnly` (the pure-TS reference scanner) against it,
 * reporting throughput and peak/final heap usage. Results are appended to
 * `scanner/README.md` under "Benchmark Results" so performance claims rest on
 * a fixture resembling a mature network's history, not the small hand-written
 * test sets used elsewhere.
 *
 * Usage:
 *   npx tsx scripts/benchmark-scan.ts [fixtureSize] [chunkSize]
 *
 * For an accurate peak-heap reading, run with `node --expose-gc` so the
 * script can force a clean baseline before scanning:
 *   node --expose-gc -r tsx/cjs scripts/benchmark-scan.ts
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveKeysFromSignature, keysToStealthMetaAddress } from "../src/crypto/dksap";
import { scanAnnouncementsViewOnly, type StealthAnnouncement } from "../src/crypto/scan";
import { bytesToHex } from "../src/crypto/bytes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURVE = secp256k1;
const N = CURVE.CURVE.n;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed always produces the same
// fixture, so benchmark runs are comparable across machines and over time.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXTURE_SEED = 0xc0ffee;

function randomScalar(prng: () => number): bigint {
  // 8 x 32-bit words -> 256-bit candidate, rejection-sampled against the
  // curve order so every scalar this produces is a valid private key.
  while (true) {
    let hex = "";
    for (let i = 0; i < 8; i++) {
      hex += Math.floor(prng() * 0x100000000)
        .toString(16)
        .padStart(8, "0");
    }
    const candidate = BigInt("0x" + hex);
    if (candidate > 0n && candidate < N) {
      return candidate;
    }
  }
}

function scalarToBytes32(s: bigint): Uint8Array {
  const hex = s.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Real DKSAP derivation (sender side), mirroring `computeStealthAddressAndViewTag`
 * but with a caller-supplied (here: deterministically seeded) ephemeral key
 * instead of OS randomness, so planted true-positive fixtures are reproducible. */
function deriveAnnouncement(
  ephemeralPriv: Uint8Array,
  viewPubKey: Uint8Array,
  spendPubKey: Uint8Array,
): { ephemeralPubKey: Uint8Array; stealthAddress: string; viewTag: number } {
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
  const ephScalar = BigInt("0x" + bytesToHex(ephemeralPriv)) % N;
  const viewPoint = CURVE.ProjectivePoint.fromHex(viewPubKey);
  const shared = viewPoint.multiply(ephScalar).toRawBytes(true);
  const sH = keccak_256(shared);
  const viewTag = sH[0];
  const sHScalar = BigInt("0x" + bytesToHex(sH)) % N;
  const sHPoint = CURVE.ProjectivePoint.BASE.multiply(sHScalar);
  const spendPoint = CURVE.ProjectivePoint.fromHex(spendPubKey);
  const stealthPoint = spendPoint.add(sHPoint);
  const uncompressed = stealthPoint.toRawBytes(false);
  const addressHash = keccak_256(uncompressed.slice(1));
  const stealthAddress = "0x" + bytesToHex(addressHash.slice(12));
  return { ephemeralPubKey, stealthAddress, viewTag };
}

interface Fixture {
  announcements: StealthAnnouncement[];
  plantedCount: number;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
}

/**
 * Builds a deterministic fixture of `size` announcements. `plantEvery`
 * controls the density of real matches planted among the noise (e.g. 5000 ->
 * ~size/5000 genuine matches for a correctness cross-check alongside the
 * throughput numbers).
 */
function buildFixture(size: number, plantEvery = 5000): Fixture {
  const prng = mulberry32(FIXTURE_SEED);
  const { viewingKey, spendingKey } = deriveKeysFromSignature("0x" + "ab".repeat(64));
  const { V: viewPubKey, S: spendPubKey } = keysToStealthMetaAddress(viewingKey, spendingKey);

  const announcements: StealthAnnouncement[] = new Array(size);
  let plantedCount = 0;

  for (let i = 0; i < size; i++) {
    const ephemeralPriv = scalarToBytes32(randomScalar(prng));

    if (i % plantEvery === 0) {
      // Planted true positive: derived for this recipient's real keys.
      const { ephemeralPubKey, stealthAddress, viewTag } = deriveAnnouncement(
        ephemeralPriv,
        viewPubKey,
        spendPubKey,
      );
      announcements[i] = { stealthAddress, ephemeralPubKey, viewTag };
      plantedCount += 1;
    } else {
      // Noise: a structurally valid announcement (real curve point for the
      // ephemeral key, since the scanner does real point arithmetic on it)
      // that is not addressed to this recipient.
      const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
      const viewTag = Math.floor(prng() * 256);
      const addrBytes = new Uint8Array(20);
      for (let b = 0; b < 20; b++) addrBytes[b] = Math.floor(prng() * 256);
      announcements[i] = {
        stealthAddress: "0x" + bytesToHex(addrBytes),
        ephemeralPubKey,
        viewTag,
      };
    }
  }

  return { announcements, plantedCount, viewingKey, spendingPubKey: spendPubKey };
}

function heapMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

async function main(): Promise<void> {
  const fixtureSize = Number(process.argv[2] ?? 120_000);
  const chunkSize = Number(process.argv[3] ?? 10_000);

  console.log(`[benchmark-scan] Building deterministic fixture of ${fixtureSize.toLocaleString()} announcements…`);
  const buildStart = process.hrtime.bigint();
  const fixture = buildFixture(fixtureSize);
  const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
  console.log(`[benchmark-scan] Fixture built in ${formatMs(buildMs)} (${fixture.plantedCount} planted matches).`);

  if (typeof global.gc === "function") {
    global.gc();
  }
  const baselineHeap = heapMb();
  let peakHeap = baselineHeap;

  const allMatches: ReturnType<typeof scanAnnouncementsViewOnly> = [];
  const scanStart = process.hrtime.bigint();

  for (let offset = 0; offset < fixture.announcements.length; offset += chunkSize) {
    const chunk = fixture.announcements.slice(offset, offset + chunkSize);
    const matches = scanAnnouncementsViewOnly({
      announcements: chunk,
      viewingKey: fixture.viewingKey,
      spendingPubKey: fixture.spendingPubKey,
    });
    allMatches.push(...matches);
    peakHeap = Math.max(peakHeap, heapMb());
    // Yield to the event loop between chunks so this behaves like a
    // long-running scan rather than one giant synchronous block, and so
    // memory sampling reflects genuinely separate points in time.
    await new Promise((resolve) => setImmediate(resolve));
  }

  const scanMs = Number(process.hrtime.bigint() - scanStart) / 1e6;
  const finalHeap = heapMb();
  const throughput = fixture.announcements.length / (scanMs / 1000);

  if (allMatches.length !== fixture.plantedCount) {
    console.error(
      `[benchmark-scan] CORRECTNESS FAILURE: expected ${fixture.plantedCount} matches, found ${allMatches.length}.`,
    );
    process.exitCode = 1;
    return;
  }

  const results = {
    timestamp: new Date().toISOString(),
    fixtureSize: fixture.announcements.length,
    chunkSize,
    plantedMatches: fixture.plantedCount,
    matchesFound: allMatches.length,
    scanMs: Math.round(scanMs),
    throughputPerSec: Math.round(throughput),
    baselineHeapMb: Math.round(baselineHeap * 10) / 10,
    peakHeapMb: Math.round(peakHeap * 10) / 10,
    finalHeapMb: Math.round(finalHeap * 10) / 10,
  };

  console.log("[benchmark-scan] Results:", results);
  writeResultsToReadme(results);
}

function writeResultsToReadme(results: {
  timestamp: string;
  fixtureSize: number;
  chunkSize: number;
  plantedMatches: number;
  matchesFound: number;
  scanMs: number;
  throughputPerSec: number;
  baselineHeapMb: number;
  peakHeapMb: number;
  finalHeapMb: number;
}): void {
  const readmePath = path.resolve(__dirname, "../../scanner/README.md");
  const marker = "<!-- benchmark-scan:latest -->";
  const block = [
    marker,
    "### Latest benchmark run",
    "",
    `- **Run at**: ${results.timestamp}`,
    `- **Fixture size**: ${results.fixtureSize.toLocaleString()} announcements (${results.plantedMatches} planted true positives, verified found: ${results.matchesFound})`,
    `- **Chunk size**: ${results.chunkSize.toLocaleString()}`,
    `- **Scan time**: ${results.scanMs.toLocaleString()} ms`,
    `- **Throughput**: ${results.throughputPerSec.toLocaleString()} announcements/sec`,
    `- **Heap usage**: baseline ${results.baselineHeapMb} MB → peak ${results.peakHeapMb} MB → final ${results.finalHeapMb} MB`,
    "",
    "Reproduce with: `npx tsx scripts/benchmark-scan.ts [fixtureSize] [chunkSize]` from `sdk/`.",
  ].join("\n");

  let content = "";
  try {
    content = fs.readFileSync(readmePath, "utf-8");
  } catch {
    content = "";
  }

  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    const separator = content.trim().length > 0 ? "\n\n" : "";
    content = `${content}${separator}${block}\n`;
  } else {
    // Replace the existing latest-run block (from the marker to the next
    // top-level heading or end of file) so the README always shows one
    // current result rather than growing unbounded across runs.
    const rest = content.slice(markerIndex);
    const nextHeadingMatch = /\n## /.exec(rest.slice(marker.length));
    const blockEnd =
      nextHeadingMatch != null ? markerIndex + marker.length + nextHeadingMatch.index : content.length;
    content = content.slice(0, markerIndex) + block + "\n" + content.slice(blockEnd);
  }

  fs.mkdirSync(path.dirname(readmePath), { recursive: true });
  fs.writeFileSync(readmePath, content, "utf-8");
  console.log(`[benchmark-scan] Results recorded in ${readmePath}`);
}

main().catch((err) => {
  console.error("[benchmark-scan] Fatal:", err);
  process.exitCode = 1;
});
