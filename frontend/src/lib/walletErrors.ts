/**
 * Wallet connection error taxonomy (#541).
 *
 * Freighter connection failures currently surface as a single generic error
 * regardless of cause. This module classifies failures and provides
 * cause-specific guidance for each.
 */

export type WalletConnectionErrorType =
  | "extension_missing"
  | "extension_locked"
  | "wrong_network"
  | "user_rejected"
  | "access_denied"
  | "unknown";

export type WalletConnectionErrorDetails = {
  type: WalletConnectionErrorType;
  message: string;
  guidance: string;
  canRetry: boolean;
};

const ERROR_MAP: Record<WalletConnectionErrorType, Omit<WalletConnectionErrorDetails, "type">> = {
  extension_missing: {
    message: "Freighter extension is not installed.",
    guidance: "Install the Freighter browser extension from the Chrome Web Store or Firefox Add-ons.",
    canRetry: false,
  },
  extension_locked: {
    message: "Freighter wallet is locked.",
    guidance: "Unlock your Freighter wallet by entering your password, then try again.",
    canRetry: true,
  },
  wrong_network: {
    message: "Wallet is connected to a different network.",
    guidance: "Switch your Freighter wallet to the correct Stellar network (Testnet or Mainnet) to match this application.",
    canRetry: true,
  },
  user_rejected: {
    message: "Connection was rejected by the user.",
    guidance: "You declined the connection request. Click 'Connect Wallet' and approve the access when prompted.",
    canRetry: true,
  },
  access_denied: {
    message: "Freighter access was denied.",
    guidance: "Grant this application access in your Freighter wallet settings, then try again.",
    canRetry: true,
  },
  unknown: {
    message: "An unexpected wallet error occurred.",
    guidance: "Check that Freighter is installed and unlocked, then try again. If the problem persists, reinstall the extension.",
    canRetry: true,
  },
};

export function classifyWalletError(error: unknown): WalletConnectionErrorDetails {
  const msg = extractMessage(error);

  if (isExtensionMissing(msg)) {
    return { type: "extension_missing", ...ERROR_MAP.extension_missing };
  }
  if (isExtensionLocked(msg)) {
    return { type: "extension_locked", ...ERROR_MAP.extension_locked };
  }
  if (isWrongNetwork(msg)) {
    return { type: "wrong_network", ...ERROR_MAP.wrong_network };
  }
  if (isAccessDenied(msg)) {
    return { type: "access_denied", ...ERROR_MAP.access_denied };
  }
  if (isUserRejected(msg)) {
    return { type: "user_rejected", ...ERROR_MAP.user_rejected };
  }
  return { type: "unknown", ...ERROR_MAP.unknown };
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown };
    if (typeof o.message === "string") return o.message;
    if (typeof o.code === "string") return o.code;
  }
  return "";
}

function isExtensionMissing(msg: string): boolean {
  return /freighter.*not.*found|freighter.*not.*installed|window\.__freighter.*undefined|freighter.*undefined|could not find freighter|freighter.*missing/i.test(msg);
}

function isExtensionLocked(msg: string): boolean {
  return /locked|unlock|password|not.*authenticated/i.test(msg);
}

function isWrongNetwork(msg: string): boolean {
  return /network.*mismatch|wrong.*network|incorrect.*network|network.*not.*supported|different.*network/i.test(msg);
}

function isUserRejected(msg: string): boolean {
  return /rejected|denied|cancelled|canceled|user.*refused|user.*denied/i.test(msg);
}

function isAccessDenied(msg: string): boolean {
  return /access.*denied|not.*allowed|permission.*denied|not.*authorized/i.test(msg);
}
