/**
 * Returns the current encryption passphrase from the security settings store.
 *
 * Importable by any store that needs encrypted localStorage without creating
 * circular dependencies (stores → securitySettingsStore → stores).
 *
 * Returns null if encryption is not enabled or no passphrase has been entered
 * for the current session.
 */

import { useSecuritySettingsStore } from "../store/securitySettingsStore";

export function getEncryptionPassphrase(): string | null {
  const state = useSecuritySettingsStore.getState();
  if (!state.encryptionEnabled) return null;
  return state.getPassphrase();
}
