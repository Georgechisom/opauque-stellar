import JSZip from "jszip";
import type { PoolNote } from "./poolNotes";

const BACKUP_VERSION = 1;
const KDF_ITERATIONS = 250_000;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(out);
  return out;
}

async function deriveBackupKey(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: KDF_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
}

export function poolNoteBackupFilename(createdAt = new Date()): string {
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  return `opaque-pool-notes-${stamp}.zip`;
}

export async function buildEncryptedPoolNoteBackup(opts: {
  notes: PoolNote[];
  pin: string;
  cluster: string;
  poolId?: string;
}): Promise<Blob> {
  const createdAt = new Date().toISOString();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveBackupKey(opts.pin, salt);
  const payload = {
    version: BACKUP_VERSION,
    createdAt,
    cluster: opts.cluster,
    poolId: opts.poolId ?? null,
    notes: opts.notes,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );

  const manifest = {
    version: BACKUP_VERSION,
    createdAt,
    noteCount: opts.notes.length,
    cluster: opts.cluster,
    poolId: opts.poolId ?? null,
    payload: "pool-notes.json.enc",
    cipher: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
  };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("pool-notes.json.enc", ciphertext);
  zip.file(
    "README.txt",
    [
      "Opaque privacy-pool note backup",
      "",
      "This archive contains encrypted pool note spending material.",
      "The encrypted JSON cannot be recovered without the PIN used at export time.",
      "Anyone with the decrypted notes can withdraw the matching pool funds.",
      "",
    ].join("\n"),
  );
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
