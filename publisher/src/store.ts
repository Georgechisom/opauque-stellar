import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeHex32 } from "./bytes.ts";
import type { LeafCommitment, PublisherState } from "./types.ts";

export interface Store {
  load(verifierId: string): PublisherState | null;
  save(state: PublisherState): void;
  readInbox(now: () => string): LeafCommitment[];
  writeInbox(commitment: LeafCommitment): void;
  archiveInbox(ids: string[]): void;
}

export function normalizeCommitment(raw: unknown, now: () => string): LeafCommitment {
  const obj = raw as Partial<LeafCommitment>;
  const leaf = normalizeHex32(String(obj.leaf ?? ""), "leaf");
  const id = String(obj.id ?? obj.attestationUid ?? leaf).trim().toLowerCase();
  if (!id) throw new Error("commitment id is required");
  return {
    id,
    leaf,
    schemaId: obj.schemaId ? normalizeHex32(obj.schemaId, "schemaId") : undefined,
    attestationUid: obj.attestationUid ? normalizeHex32(obj.attestationUid, "attestationUid") : undefined,
    txHash: obj.txHash,
    ledger: obj.ledger,
    submittedAt: obj.submittedAt ?? now(),
  };
}

export class FileStore implements Store {
  constructor(private readonly dataDir: string) {}

  private statePath(verifierId: string): string {
    return join(this.dataDir, "state", `${verifierId}.json`);
  }

  private inboxDir(): string {
    return join(this.dataDir, "inbox");
  }

  private archiveDir(): string {
    return join(this.dataDir, "archive");
  }

  load(verifierId: string): PublisherState | null {
    const p = this.statePath(verifierId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as PublisherState;
  }

  save(state: PublisherState): void {
    const p = this.statePath(state.verifierId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
  }

  readInbox(now: () => string): LeafCommitment[] {
    const dir = this.inboxDir();
    if (!existsSync(dir)) return [];
    const out: LeafCommitment[] = [];
    for (const name of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const p = join(dir, name);
      const raw = JSON.parse(readFileSync(p, "utf8"));
      out.push(normalizeCommitment(raw, now));
    }
    return out;
  }

  writeInbox(commitment: LeafCommitment): void {
    const safeId = commitment.id.replace(/[^a-z0-9_.-]/gi, "_");
    const p = join(this.inboxDir(), `${safeId}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(commitment, null, 2)}\n`);
  }

  archiveInbox(ids: string[]): void {
    if (ids.length === 0) return;
    const dir = this.inboxDir();
    if (!existsSync(dir)) return;
    mkdirSync(this.archiveDir(), { recursive: true });
    const wanted = new Set(ids);
    for (const name of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p = join(dir, name);
      try {
        const raw = JSON.parse(readFileSync(p, "utf8"));
        const commitment = normalizeCommitment(raw, () => new Date().toISOString());
        if (wanted.has(commitment.id)) {
          renameSync(p, join(this.archiveDir(), name));
        }
      } catch {
        unlinkSync(p);
      }
    }
  }
}

export class MemoryStore implements Store {
  private state: PublisherState | null = null;
  inbox: LeafCommitment[] = [];
  archived: string[] = [];

  load(): PublisherState | null {
    return this.state ? structuredClone(this.state) : null;
  }

  save(state: PublisherState): void {
    this.state = structuredClone(state);
  }

  readInbox(): LeafCommitment[] {
    return structuredClone(this.inbox);
  }

  writeInbox(commitment: LeafCommitment): void {
    this.inbox.push(structuredClone(commitment));
  }

  archiveInbox(ids: string[]): void {
    this.archived.push(...ids);
    this.inbox = this.inbox.filter((x) => !ids.includes(x.id));
  }
}
