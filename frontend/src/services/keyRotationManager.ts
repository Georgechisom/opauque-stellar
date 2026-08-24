/**
 * Stealth Key Rotation Manager (#554).
 *
 * Implements guided key rotation allowing users to cycle compromised meta-addresses,
 * register a fresh meta-address, maintain background scanning of legacy addresses
 * during a configurable grace period, and store rotation history strictly in local storage.
 */

import {
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  bytesToHex,
  type Hex,
} from "../lib/stealth";

export interface KeyRotationRecord {
  id: string;
  oldMetaAddress: string;
  newMetaAddress: string;
  oldViewingKeyHex?: string;
  oldSpendingKeyHex?: string;
  newViewingKeyHex?: string;
  newSpendingKeyHex?: string;
  rotatedAt: string; // ISO timestamp
  gracePeriodDays: number;
  gracePeriodExpiresAt: string; // ISO timestamp
  isScanningActive: boolean;
  notes?: string;
}

const ROTATION_STORAGE_KEY = "opaque_stealth_key_rotation_history";

export class KeyRotationManager {
  /**
   * Generates a cryptographically valid new stealth meta-address and keypair.
   */
  static async generateNewMetaAddress(currentAddress?: string): Promise<{
    metaAddressHex: Hex;
    viewingKeyHex: Hex;
    spendingKeyHex: Hex;
  }> {
    void currentAddress;
    // Generate fresh random 32-byte viewing and spending private keys
    const viewPriv = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const spendPriv = globalThis.crypto.getRandomValues(new Uint8Array(32));

    const { metaAddress } = keysToStealthMetaAddress(viewPriv, spendPriv);
    const metaAddressHex = stealthMetaAddressToHex(metaAddress);

    return {
      metaAddressHex,
      viewingKeyHex: (`0x${bytesToHex(viewPriv)}`) as Hex,
      spendingKeyHex: (`0x${bytesToHex(spendPriv)}`) as Hex,
    };
  }

  /**
   * Executes key rotation and persists the record strictly in local storage.
   */
  static async rotateKeys(params: {
    oldMetaAddress: string;
    gracePeriodDays?: number;
    oldViewingKeyHex?: string;
    oldSpendingKeyHex?: string;
  }): Promise<{
    record: KeyRotationRecord;
    newMetaAddress: string;
    newViewingKeyHex: string;
    newSpendingKeyHex: string;
  }> {
    const graceDays = params.gracePeriodDays ?? 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);

    const { metaAddressHex, viewingKeyHex, spendingKeyHex } =
      await this.generateNewMetaAddress(params.oldMetaAddress);

    const record: KeyRotationRecord = {
      id: `rot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      oldMetaAddress: params.oldMetaAddress,
      newMetaAddress: metaAddressHex,
      oldViewingKeyHex: params.oldViewingKeyHex,
      oldSpendingKeyHex: params.oldSpendingKeyHex,
      newViewingKeyHex: viewingKeyHex,
      newSpendingKeyHex: spendingKeyHex,
      rotatedAt: now.toISOString(),
      gracePeriodDays: graceDays,
      gracePeriodExpiresAt: expiresAt.toISOString(),
      isScanningActive: true,
    };

    const history = this.getRotationHistory();
    history.unshift(record);
    this.saveRotationHistory(history);

    return {
      record,
      newMetaAddress: metaAddressHex,
      newViewingKeyHex: viewingKeyHex,
      newSpendingKeyHex: spendingKeyHex,
    };
  }

  /**
   * Retrieves all rotation records stored strictly on local device.
   */
  static getRotationHistory(): KeyRotationRecord[] {
    if (typeof window === "undefined" || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem(ROTATION_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Saves rotation records strictly to local storage.
   */
  static saveRotationHistory(history: KeyRotationRecord[]): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(ROTATION_STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.error("Failed to save key rotation history to local storage", e);
    }
  }

  /**
   * Returns old viewing keys that remain active for scanning during their grace period.
   */
  static getActiveGraceScanningKeys(): Array<{ metaAddress: string; viewingKeyHex?: string; expiresAt: string }> {
    const now = Date.now();
    const history = this.getRotationHistory();

    return history
      .filter((rec) => rec.isScanningActive && new Date(rec.gracePeriodExpiresAt).getTime() > now)
      .map((rec) => ({
        metaAddress: rec.oldMetaAddress,
        viewingKeyHex: rec.oldViewingKeyHex,
        expiresAt: rec.gracePeriodExpiresAt,
      }));
  }

  static getMigrationSteps() {
    return [
      { id: 1, title: "Configure Grace Period" },
      { id: 2, title: "Generate New Keys" },
      { id: 3, title: "Republish Meta-Address" },
      { id: 4, title: "Enable Straggler Scanner" },
      { id: 5, title: "Share New Address" },
    ];
  }
}
