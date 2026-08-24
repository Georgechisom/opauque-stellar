import React, { useState, useEffect } from "react";
import { KeyRotationManager, type KeyRotationRecord } from "../../services/keyRotationManager";
import { useKeys } from "../../context/KeysContext";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { CopyStatusHint } from "../CopyStatusHint";

export const KeyRotationWizard: React.FC = () => {
  const steps = KeyRotationManager.getMigrationSteps();
  const { stealthMetaAddressHex } = useKeys();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [gracePeriodDays, setGracePeriodDays] = useState(30);
  const [rotatedRecord, setRotatedRecord] = useState<KeyRotationRecord | null>(null);
  const [history, setHistory] = useState<KeyRotationRecord[]>([]);
  const copyHelper = useCopyToClipboard();

  useEffect(() => {
    setHistory(KeyRotationManager.getRotationHistory());
  }, []);

  const handleNext = async () => {
    setLoading(true);
    try {
      if (currentStep === 1) {
        // Proceed to key generation
        setCurrentStep(2);
      } else if (currentStep === 2) {
        // Generate new keys and execute rotation
        const currentAddr = stealthMetaAddressHex || "G_CURRENT_META_UNKNOWN";
        const { record } = await KeyRotationManager.rotateKeys({
          oldMetaAddress: currentAddr,
          gracePeriodDays,
        });
        setRotatedRecord(record);
        setHistory(KeyRotationManager.getRotationHistory());
        setCurrentStep(3);
      } else if (currentStep === 3) {
        // Simulate on-chain registry republish
        setCurrentStep(4);
      } else if (currentStep === 4) {
        // Enable straggler scanner
        setCurrentStep(5);
      } else {
        // Completed
        setCurrentStep(1);
        setRotatedRecord(null);
      }
    } catch (e) {
      console.error("Key rotation error:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-950 p-6 shadow-xl space-y-6">
      <div>
        <h3 className="text-xl font-bold text-white">Stealth Key Rotation & Recovery</h3>
        <p className="mt-1 text-sm text-mist">
          If you suspect your viewing or spending keys are compromised, rotate to a fresh meta-address.
          Old incoming payments will continue to be scanned during your configured grace period.
        </p>
      </div>

      {/* Stepper Header */}
      <div className="grid grid-cols-5 gap-2 border-b border-ink-800 pb-4">
        {steps.map((step) => (
          <div key={step.id} className="flex flex-col items-center text-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                currentStep === step.id
                  ? "bg-glow text-ink-950 ring-2 ring-glow/40"
                  : currentStep > step.id
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-ink-800 text-mist/60 border border-ink-700"
              }`}
            >
              {currentStep > step.id ? "✓" : step.id}
            </div>
            <span
              className={`mt-1.5 text-xs font-medium ${
                currentStep === step.id ? "text-white" : "text-mist/60"
              }`}
            >
              {step.title}
            </span>
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 min-h-[160px] flex flex-col justify-center">
        {currentStep === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-white font-medium">Select Straggler Scanning Grace Period:</p>
            <p className="text-xs text-mist">
              How long your local scanner should continue monitoring transactions sent to your old address:
            </p>
            <div className="grid grid-cols-4 gap-2 pt-2">
              {[7, 14, 30, 60].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setGracePeriodDays(days)}
                  className={`rounded-xl border p-2.5 text-xs font-semibold transition-colors ${
                    gracePeriodDays === days
                      ? "border-glow bg-glow/10 text-glow"
                      : "border-ink-700 bg-ink-950 text-mist hover:border-ink-600 hover:text-white"
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-white font-medium">Generate Fresh Stealth Cryptographic Keys</p>
            <p className="text-xs text-mist max-w-md mx-auto">
              A new non-custodial secp256k1 viewing and spending key pair will be generated locally in your browser.
            </p>
          </div>
        )}

        {currentStep === 3 && rotatedRecord && (
          <div className="space-y-3">
            <p className="text-sm text-white font-medium">New Meta-Address Generated</p>
            <div className="rounded-xl border border-ink-700 bg-ink-950 p-3">
              <span className="text-xs text-mist block mb-1">New Meta-Address:</span>
              <p className="break-all font-mono text-xs text-emerald-400 select-all">
                {rotatedRecord.newMetaAddress}
              </p>
            </div>
            <p className="text-xs text-mist">
              Publishing the updated stealth meta-address to the on-chain registry...
            </p>
          </div>
        )}

        {currentStep === 4 && rotatedRecord && (
          <div className="space-y-3">
            <p className="text-sm text-white font-medium">Background Straggler Scanner Activated</p>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              ✓ Old meta-address will be monitored in the background until{" "}
              <span className="font-semibold text-white">
                {new Date(rotatedRecord.gracePeriodExpiresAt).toLocaleDateString()}
              </span>
              . Any remaining funds sent to your old address will still be detected and sweepable.
            </div>
          </div>
        )}

        {currentStep === 5 && rotatedRecord && (
          <div className="space-y-3">
            <p className="text-sm text-white font-medium">Key Rotation Complete & Ready to Share</p>
            <div className="rounded-xl border border-ink-700 bg-ink-950 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-mist">Your Active Meta-Address:</span>
                <button
                  type="button"
                  onClick={() => copyHelper.copy(rotatedRecord.newMetaAddress)}
                  className="text-xs font-semibold text-glow hover:underline"
                >
                  {copyHelper.status === "copied" ? "Copied!" : "Copy Address"}
                </button>
              </div>
              <p className="break-all font-mono text-xs text-white select-all">
                {rotatedRecord.newMetaAddress}
              </p>
              <CopyStatusHint
                status={copyHelper.status}
                remaining={copyHelper.remaining}
                onCancelClear={copyHelper.cancelClear}
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-mist/60">
          🔒 Rotation history is encrypted and stored locally only.
        </span>
        <button
          type="button"
          onClick={handleNext}
          disabled={loading}
          className="rounded-xl bg-glow px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-[#ffe24f] disabled:opacity-40 transition-colors"
        >
          {loading ? "Processing…" : currentStep === steps.length ? "Finish Rotation" : "Next Step"}
        </button>
      </div>

      {/* Local Rotation History */}
      {history.length > 0 && (
        <div className="mt-6 border-t border-ink-800 pt-5">
          <h4 className="text-sm font-semibold text-white mb-3">Local Rotation History</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {history.map((rec) => {
              const isGraceActive = new Date(rec.gracePeriodExpiresAt).getTime() > Date.now();
              return (
                <div
                  key={rec.id}
                  className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 text-xs flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-white font-mono truncate">
                      {rec.oldMetaAddress.slice(0, 16)}… → {rec.newMetaAddress.slice(0, 16)}…
                    </p>
                    <p className="text-mist/60">
                      Rotated: {new Date(rec.rotatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold shrink-0 ${
                      isGraceActive
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                        : "bg-ink-800 text-mist border border-ink-700"
                    }`}
                  >
                    {isGraceActive ? `Scan Grace (${rec.gracePeriodDays}d)` : "Completed"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
