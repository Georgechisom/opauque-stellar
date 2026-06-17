import { Link } from "react-router-dom";
import { LegalPageLayout } from "./LegalPageLayout";
import { ABUSE_POLICY_ROUTE } from "../lib/abusePolicy";
import { THREAT_MODEL_ROUTE } from "../lib/privacyThreatModel";

export function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service">
      <section>
        <h2 className="text-white font-medium text-base mb-2">Acceptance</h2>
        <p>
          By accessing official Opaque interfaces or using the protocol through those
          interfaces, you agree to these terms. If you do not agree, do not use the
          official frontend, hosted services, relayers, support channels, or related
          infrastructure.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Non-custodial nature</h2>
        <p>
          Opaque is open-source software, smart contracts, and optional hosted
          interfaces. The developers and operators of the official frontend do not take
          custody of your funds, private keys, pool notes, or wallet seed phrases. You
          authorize transactions through your own wallet.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">User responsibility</h2>
        <p>
          You are responsible for your keys, backups, pool notes, passwords, device
          security, transaction review, network selection, and tax or reporting duties.
          Lost keys, deleted local data, wrong-network transactions, or incorrect
          recipient details may cause irreversible loss.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Eligibility</h2>
        <p>
          You must be legally able to use digital asset software in your jurisdiction.
          You may not use official Opaque deployments if you are barred by applicable
          law, sanctions, court order, or platform restriction. You are responsible for
          determining whether your use is lawful where you are located.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Acceptable Use &amp; Abuse</h2>
        <p>
          You may not use Opaque for sanctions evasion, fraud, malware, phishing,
          impersonation, harassment, money laundering where prohibited by law, or other
          unlawful activity. Operators may restrict access to official infrastructure
          they control. See the{" "}
          <Link
            to={ABUSE_POLICY_ROUTE}
            className="text-white underline hover:text-white font-medium"
          >
            Abuse &amp; Sanctions Response Policy
          </Link>{" "}
          for reporting channels, response limits, and privacy guarantees.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Privacy limits</h2>
        <p>
          Opaque reduces selected forms of wallet linkability, but public ledgers and
          network providers still expose metadata. Before using privacy features, review
          the{" "}
          <Link
            to={THREAT_MODEL_ROUTE}
            className="text-white underline hover:text-white font-medium"
          >
            Privacy Threat Model
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Third-party services</h2>
        <p>
          Wallets, RPC providers, Horizon services, relayers, gateways, exchanges,
          explorers, and self-hosted forks are outside Opaque's direct control unless
          expressly operated by Opaque. Their terms, availability, fees, logs, and risk
          controls may differ from the official frontend.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Changes and availability</h2>
        <p>
          Official interfaces and services may change, be suspended, or be unavailable
          without notice. Open-source contracts and published ledger data may continue
          to exist even when hosted infrastructure is unavailable.
        </p>
      </section>
    </LegalPageLayout>
  );
}
