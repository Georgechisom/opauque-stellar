/**
 * UI for enabling/disabling optional localStorage encryption at rest.
 *
 * When enabled, sensitive stores (transaction history, pool notes,
 * reputation traits) are encrypted with AES-256-GCM using a
 * passphrase-derived key. The passphrase is held in memory only
 * and must be entered each session.
 */

import React, { useState, useCallback } from "react";
import { useSecuritySettingsStore } from "../store/securitySettingsStore";

export const StorageEncryptionSettings: React.FC = () => {
  const { encryptionEnabled, enableEncryption, disableEncryption, setPassphrase, clearPassphrase } =
    useSecuritySettingsStore();
  const [input, setInput] = useState("");
  const [showInput, setShowInput] = useState(false);

  const handleEnable = useCallback(() => {
    if (input.length < 8) return;
    setPassphrase(input);
    enableEncryption();
    setInput("");
    setShowInput(false);
  }, [input, setPassphrase, enableEncryption]);

  const handleDisable = useCallback(() => {
    disableEncryption();
    clearPassphrase();
  }, [disableEncryption, clearPassphrase]);

  const handleUnlock = useCallback(() => {
    if (input.length < 1) return;
    setPassphrase(input);
    setInput("");
    setShowInput(false);
  }, [input, setPassphrase]);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-2">Storage Encryption</h3>
      <p className="text-sm text-neutral-400 mb-4">
        Optionally encrypt sensitive local data (transaction history, pool notes,
        reputation traits) at rest using AES-256-GCM. When enabled, you must
        enter your passphrase each session to decrypt.
      </p>

      {encryptionEnabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium text-emerald-400">Encryption enabled</span>
          </div>
          <p className="text-xs text-neutral-500">
            Data is encrypted at rest. Enter your passphrase on each visit to
            decrypt.
          </p>
          <div className="flex gap-2">
            {showInput ? (
              <>
                <input
                  type="password"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                  placeholder="Enter passphrase to unlock"
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleUnlock}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm rounded-lg transition"
                >
                  Unlock
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowInput(true)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-sm rounded-lg transition"
              >
                Enter passphrase
              </button>
            )}
          </div>
          <button
            onClick={handleDisable}
            className="text-sm text-red-400 hover:text-red-300 transition"
          >
            Disable encryption
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-neutral-500" />
            <span className="text-sm font-medium text-neutral-400">Encryption disabled</span>
          </div>
          {showInput ? (
            <div className="space-y-2">
              <input
                type="password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEnable()}
                placeholder="Choose a passphrase (min 8 characters)"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleEnable}
                  disabled={input.length < 8}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm rounded-lg transition"
                >
                  Enable encryption
                </button>
                <button
                  onClick={() => { setShowInput(false); setInput(""); }}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-sm rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Choose a strong passphrase. If you forget it, encrypted data
                cannot be recovered. Existing plaintext data will be migrated
                to encrypted format.
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowInput(true)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-sm rounded-lg transition"
            >
              Enable encryption
            </button>
          )}
        </div>
      )}
    </div>
  );
};
