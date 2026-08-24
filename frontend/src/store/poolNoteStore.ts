/**
 * Persisted privacy-pool notes (spending material). Notes are SECRETS — losing them
 * loses the funds — so they are persisted to localStorage and exposed for inclusion in
 * the wallet's encrypted backup/recovery flow via `exportNotes`/`importNotes`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PoolNote } from "../lib/poolNotes";
import { createEncryptedStorage } from "../lib/encryptedStorage";
import { getEncryptionPassphrase } from "../lib/getEncryptionPassphrase";

type PoolNoteState = {
  notes: PoolNote[];
  addNote: (note: PoolNote) => void;
  /** Mark the note with this leaf index (on a pool) spent. */
  markSpent: (cluster: string, poolId: string | undefined, leafIndex: number) => void;
  getForCluster: (cluster: string) => PoolNote[];
  /** Replace the full note set (used by recovery import). */
  importNotes: (notes: PoolNote[]) => void;
  exportNotes: () => PoolNote[];
  clear: () => void;
};

export const usePoolNoteStore = create<PoolNoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      addNote: (note) =>
        set((s) => {
          // De-dup by (cluster, poolId, leafIndex). Legacy notes have no poolId.
          const without = s.notes.filter(
            (n) =>
              !(
                n.cluster === note.cluster &&
                (n.poolId ?? "") === (note.poolId ?? "") &&
                n.leafIndex === note.leafIndex
              ),
          );
          return { notes: [...without, note] };
        }),
      markSpent: (cluster, poolId, leafIndex) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.cluster === cluster && (n.poolId ?? "") === (poolId ?? "") && n.leafIndex === leafIndex
              ? { ...n, spent: true }
              : n,
          ),
        })),
      getForCluster: (cluster) => get().notes.filter((n) => n.cluster === cluster),
      importNotes: (notes) =>
        set((s) => {
          const byKey = new Map<string, PoolNote>();
          for (const n of [...s.notes, ...notes]) {
            byKey.set(`${n.cluster}:${n.poolId ?? ""}:${n.leafIndex}`, n);
          }
          return { notes: [...byKey.values()] };
        }),
      exportNotes: () => get().notes,
      clear: () => set({ notes: [] }),
    }),
    {
      name: "opaque.pool.notes.v1",
      storage: createEncryptedStorage<PoolNoteState>(
        "opaque.pool.notes.v1",
        getEncryptionPassphrase,
      ),
    },
  ),
);
