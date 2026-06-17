import { Link } from "react-router-dom";
import { LegalPageLayout } from "./LegalPageLayout";
import {
  ABUSE_ACK_SLA_BUSINESS_DAYS,
  INFRA_CAN_BLOCK,
  INFRA_CANNOT_BLOCK,
  PUBLIC_CONTACTS,
  REPORTER_PRIVACY_GUARANTEES,
  type ContactChannel,
} from "../lib/abusePolicy";

export function AbusePolicyPage() {
  return (
    <LegalPageLayout title="Abuse & Sanctions Response">
      <section>
        <h2 className="text-white font-medium text-base mb-2">Purpose</h2>
        <p>
          Opaque is a non-custodial protocol and reference frontend for Stellar privacy
          payments and reputation proofs. This page explains how to report misuse, how
          operators can respond on official infrastructure, and where protocol-level
          limits apply.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Prohibited use</h2>
        <p>
          Official Opaque deployments must not be used for sanctions evasion, fraud,
          malware, phishing, impersonation, harassment, money laundering where prohibited
          by law, or any other unlawful activity. Privacy features do not exempt any user
          from applicable law or platform rules.
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">How to report</h2>
        <p className="mb-3">
          Include a short description, relevant transaction hashes, addresses, URLs,
          screenshots, timeframe, and optional contact information. We aim to acknowledge
          reports within {ABUSE_ACK_SLA_BUSINESS_DAYS} business days. Do not post
          private victim data, seed phrases, credentials, or exploit details in a public
          GitHub issue.
        </p>
        <ul className="space-y-3">
          {(Object.values(PUBLIC_CONTACTS) as ContactChannel[]).map((contact) => (
            <li key={contact.label} className="rounded-lg border border-ink-700 bg-ink-900/30 p-4">
              <p className="font-medium text-white">{contact.label}</p>
              <p className="text-mist text-xs mt-1">{contact.description}</p>
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-2 font-mono text-sm">
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-white underline hover:text-white"
                  >
                    {contact.email}
                  </a>
                )}
                {contact.url && (
                  <a
                    href={contact.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline hover:text-white"
                  >
                    {contact.urlLabel ?? "Open report"}
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Response process</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>We triage whether the report concerns official Opaque infrastructure, protocol code, user safety, or a third-party service.</li>
          <li>We preserve relevant evidence needed for security review, abuse handling, and legal compliance.</li>
          <li>We may remove hosted content, rate limit infrastructure, disable official links, coordinate with affected providers, or publish a security advisory.</li>
          <li>We avoid public attribution until evidence is reviewed and disclosure is appropriate.</li>
        </ol>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">What operators can block or limit</h2>
        <ul className="list-disc pl-5 space-y-2">
          {INFRA_CAN_BLOCK.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">What operators cannot block</h2>
        <ul className="list-disc pl-5 space-y-2">
          {INFRA_CANNOT_BLOCK.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Privacy guarantees</h2>
        <ul className="list-disc pl-5 space-y-2 mb-3">
          {REPORTER_PRIVACY_GUARANTEES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          The reference app does not ask for names or email addresses during normal use.
          Support reports may include whatever details a reporter chooses to provide.
          See also the{" "}
          <Link to="/privacy" className="text-white underline hover:text-white">
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-white font-medium text-base mb-2">Important limits</h2>
        <p>
          Opaque cannot reverse Stellar transactions, recover lost keys, freeze
          non-custodial accounts, or guarantee that third-party wallets, RPC providers,
          exchanges, or forks will take the same actions. Reports about conduct outside
          official Opaque infrastructure may need to be sent directly to the relevant
          platform, wallet, exchange, host, or law enforcement authority.
        </p>
      </section>
    </LegalPageLayout>
  );
}
