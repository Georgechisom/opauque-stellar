// @ts-nocheck
/**
 * Local development helper for inserting holder-submitted leaf commitments into
 * the publisher inbox.
 *
 * Usage:
 *   npm run submit:leaf -- --leaf 0x... --id <attestationUid-or-leaf-id>
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "../src/store.ts";
import { normalizeCommitment } from "../src/store.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function main() {
  const dataDir = process.env.PUBLISHER_DATA_DIR
    ? resolve(process.env.PUBLISHER_DATA_DIR)
    : join(__dirname, "..", "data");
  const leaf = arg("leaf");
  if (!leaf) throw new Error("usage: npm run submit:leaf -- --leaf 0x... [--id id]");

  const commitment = normalizeCommitment(
    {
      id: arg("id"),
      leaf,
      schemaId: arg("schema-id"),
      attestationUid: arg("attestation-uid"),
      txHash: arg("tx-hash"),
      ledger: arg("ledger") ? Number(arg("ledger")) : undefined,
    },
    () => new Date().toISOString(),
  );

  const store = new FileStore(dataDir);
  store.writeInbox(commitment);
  console.log(`queued leaf ${commitment.leaf} in ${join(dataDir, "inbox")}`);
}

main();
