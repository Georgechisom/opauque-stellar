import { useState } from "react";
import { Link } from "react-router-dom";
import { MAINNET_PRIVACY_WARNINGS, THREAT_MODEL_ROUTE } from "../../lib/privacyThreatModel";
import { canProceedToMainnet, requiresMainnetLegalAck } from "../../lib/mainnetLegal";
import { useSecurityStore } from "../../store/securityStore";
import { ModalShell } from "../ModalShell";

export const MainnetWarningModal = () => {
  const { expectedNetwork, hasAcknowledgedMainnetRisk, setHasAcknowledgedMainnetRisk } =
    useSecurityStore();
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [fundsUnderstood, setFundsUnderstood] = useState(false);

  if (!requiresMainnetLegalAck({ expectedNetwork, hasAcknowledgedMainnetRisk })) return null;

  const canProceed = canProceedToMainnet(legalAccepted, fundsUnderstood);

  const handleConfirm = () => {
    if (canProceed) setHasAcknowledgedMainnetRisk(true);
  };

  return (
    <ModalShell open onClose={() => {}} closeOnBackdrop={false} maxWidthClassName="max-w-lg">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-display text-base font-bold text-white">Mainnet warning</h3>
          <p className="mt-1 text-sm leading-relaxed text-mist">
            You are connecting to Stellar Mainnet. Privacy payment features here use{" "}
            <strong className="text-white">real XLM</strong>. Transactions are irreversible; account
            reserves and fees consume real funds. Review the documents below before proceeding.
          </p>
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-950/40 p-4 text-sm">
          <p className="mb-2 font-semibold text-white">Privacy limits on mainnet</p>
          <ul className="list-disc space-y-1 pl-4 text-mist">
            {MAINNET_PRIVACY_WARNINGS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2">
            <Link
              to={THREAT_MODEL_ROUTE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-white underline hover:text-mist"
            >
              Full privacy threat model
            </Link>
          </p>
        </div>

        <div className="space-y-3">
          <label htmlFor="legal-accepted" className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              id="legal-accepted"
              checked={legalAccepted}
              onChange={(e) => setLegalAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-white"
            />
            <span className="text-sm font-medium text-white">
              I have read and agree to the Terms of Service, Privacy Policy, and Disclaimer,
              including mainnet privacy payment use, jurisdictional restrictions, and acceptable use.
            </span>
          </label>
          <label htmlFor="funds-understood" className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              id="funds-understood"
              checked={fundsUnderstood}
              onChange={(e) => setFundsUnderstood(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-white"
            />
            <span className="text-sm font-medium text-white">
              I understand I am using mainnet and real funds are at risk.
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canProceed}
          className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-ink-950 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Proceed to Mainnet
        </button>
      </div>
    </ModalShell>
  );
};
