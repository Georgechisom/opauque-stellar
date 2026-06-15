/**
 * Records attestations issued by this wallet so the Manage page can list and
 * revoke them. The attestation engine has no on-chain "by issuer" index, so the
 * issuer side is tracked client-side (persisted to localStorage) at issuance
 * time. Received attestations are discovered separately by the scanner.
 *
 * These records hold only public attestation metadata (no secrets).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type IssuedAttestation = {
  cluster: string;
  /** 0x-prefixed 32-byte attestation UID. */
  uidHex: string;
  /** Schema id (as stored on the schema record). */
  schemaIdHex: string;
  schemaName: string;
  /** 0x-prefixed 32-byte recipient stealth-address hash. */
  stealthAddressHashHex: string;
  /** Ledger sequence at issuance (best effort). */
  createdAtSlot: number;
  /** Expiration ledger, 0 = never. */
  expirationSlot: number;
  isRevocable: boolean;
  revoked: boolean;
  txHash: string;
};

type IssuedAttestationState = {
  issued: IssuedAttestation[];
  addIssued: (a: IssuedAttestation) => void;
  markRevoked: (uidHex: string, cluster: string) => void;
  getForCluster: (cluster: string) => IssuedAttestation[];
};

export const useIssuedAttestationStore = create<IssuedAttestationState>()(
  persist(
    (set, get) => ({
      issued: [],
      addIssued: (a) =>
        set((s) => ({
          issued: [
            a,
            ...s.issued.filter(
              (x) => !(x.uidHex === a.uidHex && x.cluster === a.cluster),
            ),
          ],
        })),
      markRevoked: (uidHex, cluster) =>
        set((s) => ({
          issued: s.issued.map((x) =>
            x.uidHex === uidHex && x.cluster === cluster
              ? { ...x, revoked: true }
              : x,
          ),
        })),
      getForCluster: (cluster) =>
        get().issued.filter((x) => x.cluster === cluster),
    }),
    {
      name: "opaque-issued-attestations-v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
