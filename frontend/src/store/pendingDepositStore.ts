/**
 * Pending deposit tracker for optimistic state transitions (#114).
 *
 * When a user submits a deposit, the UI immediately shows the deposit
 * in a "pending" state while the transaction is being confirmed on-chain.
 * If the transaction fails, the optimistic state is rolled back.
 *
 * Note material (spending secrets) is only persisted to the poolNoteStore
 * after successful on-chain confirmation.
 */
import { create } from "zustand";

export type PendingDepositStatus = "pending" | "confirmed" | "failed";

export interface PendingDepositEntry {
  /** Temporary ID for this pending deposit. */
  id: string;
  /** Deposited value in stroops. */
  value: string;
  /** When the deposit was submitted. */
  submittedAt: number;
  /** Current status of the deposit. */
  status: PendingDepositStatus;
  /** Error message if the deposit failed. */
  error?: string;
  /** Transaction hash once known. */
  txHash?: string;
  /** Pool ID this deposit belongs to. */
  poolId: string;
  /** Network cluster. */
  cluster: string;
  /** Leaf index expected from the contract. */
  expectedLeafIndex: number;
}

interface PendingDepositState {
  /** Map of pending deposits by ID. */
  deposits: Record<string, PendingDepositEntry>;
  /** Add a new optimistic deposit. */
  addOptimistic: (entry: Omit<PendingDepositEntry, "id" | "status" | "submittedAt">) => string;
  /** Mark a deposit as confirmed (will be converted to a real note). */
  confirmDeposit: (id: string, txHash: string) => void;
  /** Mark a deposit as failed and show error. */
  failDeposit: (id: string, error: string) => void;
  /** Remove a confirmed/failed deposit from the pending store. */
  remove: (id: string) => void;
  /** Get all pending deposits for a cluster. */
  getPending: (cluster: string) => PendingDepositEntry[];
}

let nextId = 0;

export const usePendingDepositStore = create<PendingDepositState>()((set, get) => ({
  deposits: {},

  addOptimistic: (entry) => {
    const id = `deposit-${Date.now()}-${nextId++}`;
    const full: PendingDepositEntry = {
      ...entry,
      id,
      status: "pending",
      submittedAt: Date.now(),
    };
    set((state) => ({
      deposits: { ...state.deposits, [id]: full },
    }));
    return id;
  },

  confirmDeposit: (id, txHash) =>
    set((state) => {
      const entry = state.deposits[id];
      if (!entry) return state;
      return {
        deposits: {
          ...state.deposits,
          [id]: { ...entry, status: "confirmed", txHash },
        },
      };
    }),

  failDeposit: (id, error) =>
    set((state) => {
      const entry = state.deposits[id];
      if (!entry) return state;
      return {
        deposits: {
          ...state.deposits,
          [id]: { ...entry, status: "failed", error },
        },
      };
    }),

  remove: (id) =>
    set((state) => {
      const { [id]: _omitted, ...rest } = state.deposits;
      return { deposits: rest };
    }),

  getPending: (cluster) => {
    const all = Object.values(get().deposits);
    return all.filter((e) => e.cluster === cluster && e.status === "pending");
  },
}));
