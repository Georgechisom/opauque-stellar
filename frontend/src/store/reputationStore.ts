/**
 * Zustand store for stealth reputation / verified traits.
 *
 * Persists discovered traits to localStorage so they survive page reloads.
 * Proof state is ephemeral (lost on reload, proofs should be submitted on-chain).
 */

import { create } from "zustand";
import type { DiscoveredTrait, ProofState, ProofData } from "../lib/reputation";
import { encryptData, decryptData, isEncryptedPayload } from "../lib/encryptedStorage";
import { getEncryptionPassphrase } from "../lib/getEncryptionPassphrase";

interface ReputationState {
  discoveredTraits: DiscoveredTrait[];
  proofState: ProofState;
  lastScanTimestamp: number | null;

  setDiscoveredTraits: (traits: DiscoveredTrait[]) => void;
  addDiscoveredTrait: (trait: DiscoveredTrait) => void;
  clearTraits: () => void;

  setProofStage: (stage: ProofState["stage"], progress?: number) => void;
  setProofError: (error: string) => void;
  setProofReady: (proof: ProofData) => void;
  resetProof: () => void;
  startProof: (traitId: string) => void;

  setLastScanTimestamp: (ts: number) => void;
}

const STORAGE_KEY = "opaque-reputation-traits";

async function loadPersistedTraits(): Promise<DiscoveredTrait[]> {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;

    // Encrypted format
    if (isEncryptedPayload(parsed)) {
      const passphrase = getEncryptionPassphrase();
      if (!passphrase) return []; // can't decrypt yet
      try {
        return await decryptData<DiscoveredTrait[]>(parsed, passphrase);
      } catch {
        return []; // wrong password or corrupt
      }
    }

    // Legacy plaintext
    return parsed as DiscoveredTrait[];
  } catch {
    return [];
  }
}

async function persistTraits(traits: DiscoveredTrait[]): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    const passphrase = getEncryptionPassphrase();
    if (passphrase) {
      const encrypted = await encryptData(traits, passphrase);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(traits));
    }
  } catch {
    // Silently fail if storage is full
  }
}

const initialProofState: ProofState = {
  stage: "idle",
  progress: 0,
  traitId: null,
  error: null,
  proof: null,
};

// Load traits on mount (async due to encryption support)
let _loadedTraits: DiscoveredTrait[] | null = null;
void loadPersistedTraits().then((traits) => {
  _loadedTraits = traits;
  // If the store was created with empty traits, hydrate it
  const state = useReputationStore.getState();
  if (state.discoveredTraits.length === 0 && traits.length > 0) {
    state.setDiscoveredTraits(traits);
  }
});

export const useReputationStore = create<ReputationState>((set) => ({
  discoveredTraits: _loadedTraits ?? [],
  proofState: { ...initialProofState },
  lastScanTimestamp: null,

  setDiscoveredTraits: (traits) => {
    persistTraits(traits);
    set({ discoveredTraits: traits });
  },

  addDiscoveredTrait: (trait) =>
    set((state) => {
      const exists = state.discoveredTraits.some(
        (t) => t.txHash === trait.txHash && t.attestationId === trait.attestationId
      );
      if (exists) return state;
      const next = [...state.discoveredTraits, trait];
      persistTraits(next);
      return { discoveredTraits: next };
    }),

  clearTraits: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ discoveredTraits: [] });
  },

  setProofStage: (stage, progress) =>
    set((state) => ({
      proofState: {
        ...state.proofState,
        stage,
        progress: progress ?? state.proofState.progress,
        error: null,
      },
    })),

  setProofError: (error) =>
    set((state) => ({
      proofState: { ...state.proofState, stage: "error", error },
    })),

  setProofReady: (proof) =>
    set((state) => ({
      proofState: {
        ...state.proofState,
        stage: "proof-ready",
        progress: 100,
        proof,
      },
    })),

  resetProof: () => set({ proofState: { ...initialProofState } }),

  startProof: (traitId) =>
    set({
      proofState: {
        stage: "preparing-witness",
        progress: 0,
        traitId,
        error: null,
        proof: null,
      },
    }),

  setLastScanTimestamp: (ts) => set({ lastScanTimestamp: ts }),
}));
