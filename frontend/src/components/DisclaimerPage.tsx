import { Link } from "react-router-dom";
import { LegalPageLayout } from "./LegalPageLayout";
import { ABUSE_POLICY_ROUTE, PUBLIC_CONTACTS } from "../lib/abusePolicy";
import { THREAT_MODEL_ROUTE } from "../lib/privacyThreatModel";

export function DisclaimerPage() {
  return (
    <LegalPageLayout title="Disclaimer">
      <section>
        <h2 className="text-white font-medium text-base mb-2">Experimental software</h2>
        <p>
          Opaque is experimental software. Smart contracts, circuits, browser code,
          scanner logic, relayers, ASP roots, and integrations may contain bugs, may
          change over time, and may fail in unexpected ways. Use the protocol at your
          own risk.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">No custody or recovery</h2>
        <p>
          Opaque does not custody funds, keys, pool notes, or recovery material. Operators
          cannot reverse Stellar transactions, recover deleted local data, reset wallet
          passwords, freeze non-custodial accounts, or restore access after key loss.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">No financial, legal, or tax advice</h2>
        <p>
          This application is a tool, not a bank, broker, exchange, law firm, tax adviser,
          or money transmission service. Nothing in the app, documentation, code, or
          support messages is financial, legal, tax, or investment advice.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Privacy and cryptographic limits</h2>
        <p>
          No privacy system is perfect. Opaque can reduce selected linkability, but public
          ledger data, wallet signatures, RPC metadata, relayer metadata, weak anonymity
          sets, browser compromise, and user behavior can still reveal information. Review
          the{" "}
          <Link
            to={THREAT_MODEL_ROUTE}
            className="text-white underline hover:text-white font-medium"
          >
            Privacy Threat Model
          </Link>{" "}
          before relying on privacy features.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Regulatory compliance</h2>
        <p>
          You are responsible for complying with applicable law, including tax,
          sanctions, consumer-protection, reporting, and anti-money-laundering rules.
          Privacy-preserving tools do not exempt anyone from legal obligations.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Sanctions &amp; Abuse Reporting</h2>
        <p>
          Opaque is non-custodial and does not screen every counterparty on-chain.
          Operators can respond only within infrastructure they control. To report abuse,
          sanctions concerns, phishing, or security incidents involving official
          deployments, see the{" "}
          <Link
            to={ABUSE_POLICY_ROUTE}
            className="text-white underline hover:text-white font-medium"
          >
            Abuse &amp; Sanctions Response Policy
          </Link>{" "}
          or email{" "}
          <a
            href={`mailto:${PUBLIC_CONTACTS.abuse.email}`}
            className="text-white underline hover:text-white font-medium"
          >
            {PUBLIC_CONTACTS.abuse.email}
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">No warranty</h2>
        <p>
          The software and official interfaces are provided as is and as available, without
          warranties of any kind. To the fullest extent permitted by law, contributors and
          operators disclaim liability for losses arising from use, inability to use,
          transactions, bugs, third-party services, regulatory action, or security events.
        </p>
      </section>
    </LegalPageLayout>
  );
}
