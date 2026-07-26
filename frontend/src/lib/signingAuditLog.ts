/**
 * Local, encrypted audit log of signing events (#556).
 *
 * Every time the wallet authorizes a transaction or message signature, a
 * timestamp + action type entry is recorded so the user can later notice
 * unexpected key usage. Entries are encrypted at rest with a non-extractable
 * AES-GCM key that lives only in this device's IndexedDB — the key can be
 * used to encrypt/decrypt but never exported, and nothing here is ever sent
 * over the network.
 */

import { openDB, type IDBPDatabase } from "idb";

export type SigningActionType = "transaction" | "message";

export type SigningAuditEntry = {
  id: string;
  /** Epoch ms. */
  timestamp: number;
  actionType: SigningActionType;
};

type StoredEntry = { id: string; iv: string; ciphertext: string };

const DB_NAME = "opaque-signing-audit-log";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const ENTRY_STORE = "entries";
const AES_KEY_ID = "log-key";
/** Oldest entries roll off past this so the log can't grow unbounded. */
const MAX_ENTRIES = 500;

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
        if (!db.objectStoreNames.contains(ENTRY_STORE)) {
          db.createObjectStore(ENTRY_STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await getDb();
  const existing = (await db.get(KEY_STORE, AES_KEY_ID)) as CryptoKey | undefined;
  if (existing) return existing;
  // extractable: false — the key can encrypt/decrypt in this browser context
  // but can never be exported, including by this code.
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await db.put(KEY_STORE, key, AES_KEY_ID);
  return key;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function encryptEntry(entry: SigningAuditEntry, key: CryptoKey): Promise<StoredEntry> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(entry));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, encoded),
  );
  return { id: entry.id, iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

async function decryptEntry(stored: StoredEntry, key: CryptoKey): Promise<SigningAuditEntry> {
  const iv = base64ToBytes(stored.iv);
  const ciphertext = base64ToBytes(stored.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as SigningAuditEntry;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── In-memory cache + pub/sub, mirroring lib/errorReporting.ts ───────────

let cache: SigningAuditEntry[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
type Listener = (entries: readonly SigningAuditEntry[]) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener([...cache]);
}

function loadCache(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const db = await getDb();
        const key = await getOrCreateKey();
        const stored = (await db.getAll(ENTRY_STORE)) as StoredEntry[];
        const decrypted = await Promise.all(stored.map((s) => decryptEntry(s, key)));
        cache = decrypted.sort((a, b) => b.timestamp - a.timestamp);
      } catch {
        cache = [];
      }
      loaded = true;
      notify();
    })();
  }
  return loadPromise;
}

/** Subscribe to log changes. Returns an unsubscribe function. */
export function subscribeToSigningAuditLog(listener: Listener): () => void {
  listeners.add(listener);
  listener([...cache]);
  void loadCache();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Record a signing event. Fire-and-forget: the wallet's sign choke point
 * (context/StellarWalletProviders.tsx) calls this after a signature succeeds
 * and must not be blocked or failed by logging.
 */
export function logSigningEvent(actionType: SigningActionType): void {
  const entry: SigningAuditEntry = { id: randomId(), timestamp: Date.now(), actionType };
  void (async () => {
    await loadCache();
    cache = [entry, ...cache].slice(0, MAX_ENTRIES);
    notify();
    try {
      const db = await getDb();
      const key = await getOrCreateKey();
      await db.put(ENTRY_STORE, await encryptEntry(entry, key));
      const storedKeys = (await db.getAllKeys(ENTRY_STORE)) as string[];
      if (storedKeys.length > MAX_ENTRIES) {
        const keep = new Set(cache.map((e) => e.id));
        await Promise.all(
          storedKeys.filter((id) => !keep.has(id)).map((id) => db.delete(ENTRY_STORE, id)),
        );
      }
    } catch {
      /* best-effort persistence; the in-memory cache already reflects the event */
    }
  })();
}

/** Clear the log in one action. */
export async function clearSigningAuditLog(): Promise<void> {
  cache = [];
  loaded = true;
  notify();
  try {
    const db = await getDb();
    await db.clear(ENTRY_STORE);
  } catch {
    /* IndexedDB unavailable; in-memory state is already cleared */
  }
}
