/**
 * useViewOnlyScan: View-only scanning hook for detecting incoming transfers
 * without loading spend keys. Uses only the viewing key and spending public key.
 *
 * This implements least-privilege scanning — spend keys stay cold until sweep.
 */

import { useState, useCallback } from "react";
import { useOpaqueWasm } from "./useOpaqueWasm";
import { useKeys } from "../context/KeysContext";

export interface ViewOnlyScanResult {
  stealthAddress: string;
  isOurs: boolean;
  txHash: string;
  blockNumber: number;
}

export interface UseViewOnlyScanReturn {
  /** Scan announcements using only view keys (no spend keys loaded). */
  scanViewOnly: (
    announcements: Array<{
      stealthAddress: string;
      viewTag: number;
      ephemeralPubKey: string;
      txHash: string;
      blockNumber: number;
    }>,
  ) => ViewOnlyScanResult[];
  /** Whether the view-only scan is ready (WASM loaded and keys available). */
  isReady: boolean;
  /** Error message if view-only scan setup failed. */
  error: string | null;
}

export function useViewOnlyScan(): UseViewOnlyScanReturn {
  const { wasm, isReady: wasmReady } = useOpaqueWasm();
  const { isSetup, getMasterKeys } = useKeys();
  const [error, setError] = useState<string | null>(null);

  const scanViewOnly = useCallback(
    (
      announcements: Array<{
        stealthAddress: string;
        viewTag: number;
        ephemeralPubKey: string;
        txHash: string;
        blockNumber: number;
      }>,
    ): ViewOnlyScanResult[] => {
      if (!wasm || !wasmReady || !isSetup) {
        setError("WASM or keys not ready for view-only scan");
        return [];
      }

      try {
        const masterKeys = getMasterKeys();
        const results: ViewOnlyScanResult[] = [];

        for (const ann of announcements) {
          try {
            const ephHex = ann.ephemeralPubKey.startsWith("0x")
              ? ann.ephemeralPubKey.slice(2)
              : ann.ephemeralPubKey;
            const ephBytes = new Uint8Array(
              ephHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
            );

            if (ephBytes.length !== 33) continue;

            const isOurs = wasm.check_announcement_view_only_wasm(
              ann.stealthAddress,
              ann.viewTag,
              masterKeys.viewPrivKey,
              masterKeys.spendPubKey,
              ephBytes,
            );

            results.push({
              stealthAddress: ann.stealthAddress,
              isOurs,
              txHash: ann.txHash,
              blockNumber: ann.blockNumber,
            });
          } catch {
            // Skip malformed announcements
          }
        }

        setError(null);
        return results;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "View-only scan failed";
        setError(msg);
        return [];
      }
    },
    [wasm, wasmReady, isSetup, getMasterKeys],
  );

  return {
    scanViewOnly,
    isReady: Boolean(wasmReady && isSetup),
    error,
  };
}
