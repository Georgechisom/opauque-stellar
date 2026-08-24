/**
 * Note backup confirmation gate state management (#552).
 *
 * Ensures users secure their deposit note secrets and pass an interactive
 * verification check before the on-chain deposit transaction is signed.
 * Persists in sessionStorage to prevent bypassing via page reloads.
 */

export interface DepositBackupSession {
  id: string;
  cluster: string;
  depositor: string;
  amountXlm: string;
  valueStroops: string;
  commitmentHex: string;
  nullifierHex: string;
  secretHex: string;
  challengePrompt: string;
  expectedFragment: string;
  verified: boolean;
  createdAt: number;
}

const STORAGE_KEY = "opaque_pending_deposit_backup_gate";

export function createDepositBackupSession(params: {
  cluster: string;
  depositor: string;
  amountXlm: string;
  valueStroops: string;
  commitmentHex: string;
  nullifierHex: string;
  secretHex: string;
}): DepositBackupSession {
  // Extract the last 6 characters of the secret as verification challenge
  const secretClean = params.secretHex.replace(/^0x/, "");
  const expectedFragment = secretClean.slice(-6).toUpperCase();

  const session: DepositBackupSession = {
    id: `dep_gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cluster: params.cluster,
    depositor: params.depositor,
    amountXlm: params.amountXlm,
    valueStroops: params.valueStroops,
    commitmentHex: params.commitmentHex,
    nullifierHex: params.nullifierHex,
    secretHex: params.secretHex,
    challengePrompt: "Enter the last 6 characters of your Note Secret",
    expectedFragment,
    verified: false,
    createdAt: Date.now(),
  };

  saveDepositBackupSession(session);
  return session;
}

export function saveDepositBackupSession(session: DepositBackupSession | null): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  if (!session) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadDepositBackupSession(): DepositBackupSession | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DepositBackupSession;
    if (parsed && typeof parsed.expectedFragment === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDepositBackupSession(): void {
  saveDepositBackupSession(null);
}

export function verifyDepositFragment(session: DepositBackupSession, inputFragment: string): boolean {
  const normalizedInput = inputFragment.trim().toUpperCase().replace(/^0X/, "");
  const normalizedExpected = session.expectedFragment.trim().toUpperCase().replace(/^0X/, "");
  const isMatch = normalizedInput === normalizedExpected;
  if (isMatch) {
    session.verified = true;
    saveDepositBackupSession(session);
  }
  return isMatch;
}
