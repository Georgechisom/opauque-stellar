import { describe, it, expect } from "vitest";
import {
  ABUSE_ACK_SLA_BUSINESS_DAYS,
  ABUSE_POLICY_ROUTE,
  INCIDENT_CONTACTS,
  INFRA_CAN_BLOCK,
  INFRA_CANNOT_BLOCK,
  OPAQUE_REPO_ISSUES_URL,
  OPAQUE_REPO_SECURITY_ADVISORY_URL,
  OPAQUE_SUPPORT_EMAIL,
  PUBLIC_CONTACTS,
  REPORTER_PRIVACY_GUARANTEES,
} from "../lib/abusePolicy";

describe("abusePolicy", () => {
  it("exposes abuse policy route", () => {
    expect(ABUSE_POLICY_ROUTE).toBe("/abuse-policy");
  });

  it("documents public support and reporting contacts", () => {
    expect(PUBLIC_CONTACTS.abuse.email).toBe(OPAQUE_SUPPORT_EMAIL);
    expect(PUBLIC_CONTACTS.security.email).toBe(OPAQUE_SUPPORT_EMAIL);
    expect(PUBLIC_CONTACTS.support.email).toBe(OPAQUE_SUPPORT_EMAIL);
    expect(PUBLIC_CONTACTS.abuse.url).toBe(OPAQUE_REPO_ISSUES_URL);
    expect(PUBLIC_CONTACTS.support.url).toBe(OPAQUE_REPO_ISSUES_URL);
    expect(PUBLIC_CONTACTS.security.url).toBe(OPAQUE_REPO_SECURITY_ADVISORY_URL);
  });

  it("documents incident contacts for operators", () => {
    expect(INCIDENT_CONTACTS.incidentEmail).toBe(OPAQUE_SUPPORT_EMAIL);
    expect(INCIDENT_CONTACTS.opsChannel).toMatch(/ops/i);
  });

  it("defines infrastructure block limits", () => {
    expect(INFRA_CAN_BLOCK.length).toBeGreaterThan(0);
    expect(INFRA_CANNOT_BLOCK.length).toBeGreaterThan(INFRA_CAN_BLOCK.length - 1);
    expect(INFRA_CANNOT_BLOCK.some((item) => /non-custodial|immutable|third-party/i.test(item))).toBe(
      true,
    );
  });

  it("documents reporter privacy guarantees and SLA", () => {
    expect(REPORTER_PRIVACY_GUARANTEES.length).toBeGreaterThanOrEqual(3);
    expect(ABUSE_ACK_SLA_BUSINESS_DAYS).toBe(5);
  });
});
