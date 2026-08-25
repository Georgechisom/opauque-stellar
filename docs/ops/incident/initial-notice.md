# Template: Initial Incident Notice

**Use when:** an incident is confirmed (not just "reports coming in") and rated
P0 or P1. Post to the status page first, then link to it from every other
channel — do not draft independent versions per channel.

**Timing target:** ≤ 30 minutes after confirmation for P0, ≤ 2 hours for P1.

**Before you send:** read the ground rules in [`README.md`](README.md#ground-rules-for-funds-related-incidents).
Do not state a root cause you haven't confirmed. Do not ask users to take any
wallet action.

---

## Fill-in template

```
Title: [Investigating] <short, factual description of the symptom>

Severity: <P0 | P1>
Status: Investigating
Started: <UTC timestamp, best known estimate>
Last updated: <UTC timestamp of this post>

We are investigating <factual, observable symptom — e.g. "reports of stealth
payments not appearing in recipient scans on Stellar mainnet">.

What we know:
- <Only confirmed facts. E.g. "Contract calls to the stealth-announcer are
  succeeding on-chain." or "We have not confirmed any loss of funds.">

What we don't know yet:
- <Be honest about open questions, e.g. root cause, scope, whether it's
  ongoing or a one-time event.>

What you should do:
- <Specific, safe guidance. E.g. "Hold off on sending new stealth payments
  or depositing into the privacy pool until this notice is updated." or "No
  action needed; your funds are not at risk.">

What you should NOT do:
- Do not send funds to any stealth address generated since <timestamp or
  "further notice">.
- We will never ask you to sign a transaction, share your recovery phrase,
  or move funds to a "safe" address as part of resolving this. Treat any
  message asking you to do so — even one that looks like it's from us — as
  a scam.

We will post an update within <2-4 hours per README.md> or as soon as we
have material new information, whichever is first.

Follow this incident: <status page link>
```

---

## Example (fictional, for calibration only)

```
Title: [Investigating] Delayed stealth payment scans on Stellar testnet

Severity: P1
Status: Investigating
Started: 2026-08-24 14:02 UTC
Last updated: 2026-08-24 14:22 UTC

We are investigating reports that stealth payment scans are taking
significantly longer than usual to surface incoming funds on Stellar
testnet.

What we know:
- The stealth-announcer contract is accepting and emitting announcements
  normally on-chain.
- Scan delays appear correlated with elevated Soroban RPC latency from
  our primary provider.

What we don't know yet:
- Whether this affects mainnet or is isolated to our testnet RPC provider.
- Root cause of the RPC latency.

What you should do:
- If a payment isn't showing up in your scan, wait before resending — the
  funds are very likely still there and simply not yet visible.

What you should NOT do:
- Do not send funds to any stealth address generated in the last few hours
  until this notice is lifted.
- We will never ask you to sign a transaction or move funds to resolve this.

We will post an update within 2 hours or as soon as we have material new
information.

Follow this incident: status.opaque.example/incidents/2026-08-24-scan-delay
```
