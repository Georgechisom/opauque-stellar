import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getAddress,
  isAllowed,
  isConnected as freighterIsConnected,
  requestAccess,
  signMessage as freighterSignMessage,
  signTransaction,
} from "@stellar/freighter-api";
import { getNetworkPassphrase } from "../lib/chain";
import type { SignTxFn } from "../lib/stellar";
import { logSigningEvent } from "../lib/signingAuditLog";

export type StellarWalletContextValue = {
  publicKey: string | null;
  connected: boolean;
  connecting: boolean;
  connect: () => Promise<string>;
  disconnect: () => void;
  signTransaction: SignTxFn;
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | null;
};

export const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);

/** Extract a human message from a Freighter API error object (v3+ returns { code, message }). */
function freighterErrorMessage(error: { message?: string } | undefined, fallback: string): string {
  return error?.message?.trim() || fallback;
}

export function StellarWalletProviders({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectInFlightRef = useRef(false);

  const connect = useCallback(async (): Promise<string> => {
    if (connectInFlightRef.current) {
      const { address } = await getAddress();
      return address;
    }
    connectInFlightRef.current = true;
    setConnecting(true);
    try {
      // Authorization = isAllowed() (the app has been granted access). isConnected() only
      // reports whether the extension is installed. Request access explicitly if not allowed.
      const allowed = await isAllowed();
      if (!allowed.isAllowed) {
        const access = await requestAccess();
        if (access.error) {
          throw new Error(freighterErrorMessage(access.error, "Freighter access was denied."));
        }
        if (access.address) {
          setPublicKey(access.address);
          setConnected(true);
          return access.address;
        }
      }
      const { address, error } = await getAddress();
      if (error) throw new Error(freighterErrorMessage(error, "Could not read the wallet address."));
      if (!address) throw new Error("Freighter returned no address. Make sure it is unlocked.");
      setPublicKey(address);
      setConnected(true);
      return address;
    } finally {
      setConnecting(false);
      connectInFlightRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setConnected(false);
  }, []);

  const signTx: SignTxFn = useCallback(
    async (xdr: string) => {
      const res = await signTransaction(xdr, {
        networkPassphrase: getNetworkPassphrase(),
        address: publicKey ?? undefined,
      });
      if (res.error) throw new Error(freighterErrorMessage(res.error, "Failed to sign the transaction."));
      logSigningEvent("transaction");
      return res.signedTxXdr;
    },
    [publicKey],
  );

  const signMessage = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      // The setup message is UTF-8 text; Freighter's signMessage takes a string.
      const text = new TextDecoder().decode(message);
      const res = await freighterSignMessage(text, { address: publicKey ?? undefined });
      if (res.error) throw new Error(freighterErrorMessage(res.error, "Failed to sign the setup message."));
      const signed = res.signedMessage;
      if (signed == null) throw new Error("Freighter returned no signature.");
      logSigningEvent("message");
      // Freighter returns a Buffer (v3) or a base64 string (v4) depending on version.
      return typeof signed === "string"
        ? Uint8Array.from(Buffer.from(signed, "base64"))
        : Uint8Array.from(signed);
    },
    [publicKey],
  );

  const value = useMemo(
    () => ({
      publicKey,
      connected,
      connecting,
      connect,
      disconnect,
      signTransaction: signTx,
      signMessage,
    }),
    [publicKey, connected, connecting, connect, disconnect, signTx, signMessage],
  );

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>;
}

export async function tryRestoreFreighterSession(): Promise<string | null> {
  const installed = await freighterIsConnected();
  if (!installed.isConnected) return null;
  const allowed = await isAllowed();
  if (!allowed.isAllowed) return null;
  const { address, error } = await getAddress();
  if (error || !address) return null;
  return address;
}
