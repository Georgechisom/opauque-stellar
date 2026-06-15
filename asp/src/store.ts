/**
 * Durable per-pool ASP state. `FileStore` persists JSON under a data directory;
 * `MemoryStore` is for tests. State is small (indices + cursors), so JSON is plenty.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PoolState } from "./types.ts";

export interface Store {
  load(poolId: string): PoolState | null;
  save(state: PoolState): void;
}

export class FileStore implements Store {
  constructor(private readonly dataDir: string) {}

  private path(poolId: string): string {
    return join(this.dataDir, "state", `${poolId}.json`);
  }

  load(poolId: string): PoolState | null {
    const p = this.path(poolId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as PoolState;
  }

  save(state: PoolState): void {
    const p = this.path(state.poolId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
  }
}

export class MemoryStore implements Store {
  private states = new Map<string, PoolState>();
  load(poolId: string): PoolState | null {
    return this.states.get(poolId) ?? null;
  }
  save(state: PoolState): void {
    this.states.set(state.poolId, structuredClone(state));
  }
}
