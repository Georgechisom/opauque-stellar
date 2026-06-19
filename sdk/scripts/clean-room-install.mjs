/**
 * Clean-room install gate.
 *
 * Packs the SDK exactly as it would publish, installs the tarball into a
 * throwaway project with ONLY the required peers (no optional `circomlibjs`,
 * `snarkjs`, or `tweetnacl`), then imports and exercises it via ESM, CJS, and
 * both subpaths. This catches the class of bug a published package can have that
 * in-repo tests cannot — an optional peer accidentally required, or a broken
 * exports map — because the SDK's own node_modules always has everything.
 *
 *   npm run smoke:install
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sdkDir = process.cwd();
const log = (m) => console.log(`[clean-room] ${m}`);

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}
function capture(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf8" });
}

log("building...");
run("npm run build", sdkDir);

const work = mkdtempSync(join(tmpdir(), "opaque-cleanroom-"));
let failed = false;
try {
  log("packing tarball...");
  const packed = JSON.parse(capture(`npm pack --json --pack-destination "${work}"`, sdkDir));
  const tgz = join(work, packed[0].filename);

  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: "cleanroom", version: "1.0.0", type: "module", private: true }, null, 2),
  );

  log("installing WITHOUT optional peers (circomlibjs / snarkjs / tweetnacl)...");
  run(
    `npm install "${tgz}" @stellar/stellar-sdk "@noble/curves@^1" "@noble/hashes@^1" --no-audit --no-fund`,
    work,
  );

  writeFileSync(
    join(work, "esm.mjs"),
    [
      'import { OpaqueClient, VERSION } from "@opaquecash/stellar";',
      'import { deriveKeysFromSignature } from "@opaquecash/stellar/crypto";',
      'import { hashPoolWithdrawPayload } from "@opaquecash/stellar/relayer-protocol";',
      'const o = new OpaqueClient({ network: "testnet" });',
      'const id = o.payments.deriveIdentity("0x" + "a1".repeat(64));',
      "const t = o.payments.prepareTransfer(id.metaHex);",
      "const m = o.payments.scan({ announcements: [{ stealthAddress: t.stealthAddress, ephemeralPubKey: t.ephemeralPubKey, viewTag: t.viewTag }], identity: id });",
      'if (m[0]?.stealthStellarAddress !== t.stealthStellarAddress) throw new Error("payments scan failed");',
      'if (typeof deriveKeysFromSignature !== "function") throw new Error("crypto subpath broken");',
      'if (typeof hashPoolWithdrawPayload !== "function") throw new Error("relayer-protocol subpath broken");',
      'console.log("[clean-room] ESM + subpaths OK (v" + VERSION + ")");',
    ].join("\n"),
  );

  writeFileSync(
    join(work, "cjs.cjs"),
    [
      'const { OpaqueClient } = require("@opaquecash/stellar");',
      'const crypto = require("@opaquecash/stellar/crypto");',
      'if (typeof OpaqueClient !== "function") throw new Error("CJS main broken");',
      'if (typeof crypto.computeStealthAddressAndViewTag !== "function") throw new Error("CJS crypto subpath broken");',
      'console.log("[clean-room] CJS OK");',
    ].join("\n"),
  );

  log("running ESM consumer...");
  run("node esm.mjs", work);
  log("running CJS consumer...");
  run("node cjs.cjs", work);

  log("PASS — package installs and runs with only its required peers.");
} catch (err) {
  failed = true;
  console.error(`[clean-room] FAIL: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
