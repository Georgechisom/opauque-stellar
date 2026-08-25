# Template: Resolution Notice & Postmortem

Two parts: (1) a short **resolution notice** posted the moment the fix is
verified, and (2) a longer **postmortem** published afterward. Do not combine
them into one rushed post — users need to know it's fixed *now*; the full
account of what happened can take a bit longer to get right.

**Timing target:** resolution notice immediately on verified fix. Postmortem
within 5 business days (P0) or 10 business days (P1) per
[`README.md`](README.md#disclosure-timeline-target).

---

## Part 1 — Resolution notice (post immediately)

```
Title: [Resolved] <same short description as the initial notice>

Severity: <P0 | P1>
Status: Resolved
Incident started: <UTC timestamp>
Resolved: <UTC timestamp>
Duration: <elapsed time>

This incident is resolved. <One or two sentences on what was fixed, in
plain language — not the deep technical root cause yet, just "what's true
now.">

What this means for you:
- <E.g. "Stealth payment scans are back to normal latency; no funds were
  at risk at any point." Only state fund-safety claims you have actually
  verified — do not reassure prematurely.>

If you were affected:
- <Concrete next step if there's anything for an affected user to do —
  e.g. "If you sent a payment between <time> and <time> and it still isn't
  showing in your scan, contact us at <channel> with your transaction hash."
  If there's nothing to do, say so explicitly: "No action is needed.">

A full postmortem will be published by <target date> at <link to be added>.

Follow this incident: <status page link>
```

---

## Part 2 — Postmortem structure

Publish as a dated file in this directory or on the status page, and link it
from the resolution notice above once ready.

```
# Postmortem: <title> — <date>

## Summary
One paragraph: what happened, impact, duration, resolution — for someone
who reads only this section.

## Severity & impact
- Severity: <P0 | P1>
- Duration: <start UTC> to <end UTC> (<elapsed>)
- User impact: <concrete, quantified where legal/compliance has reviewed
  the numbers — see README.md "Ground rules">
- Funds impact: <explicit statement — "no funds were lost/at risk" or a
  precise, reviewed accounting of what was affected>

## Timeline (UTC)
| Time | Event |
|---|---|
| <ts> | <e.g. "Alert fired / report received"> |
| <ts> | <e.g. "On-call acknowledged, began investigation"> |
| <ts> | <e.g. "Root cause identified: ..."> |
| <ts> | <e.g. "Mitigation deployed"> |
| <ts> | <e.g. "Confirmed resolved, monitoring"> |

## Root cause
Technical explanation, written for engineers. Reference the specific
contract, RPC provider, or code path (e.g. link to the relevant PR or ADR
under `docs/adr/`).

## Detection
How was this found — automated alert (name it), user report, internal
testing? If detection was slower than it should have been, say so.

## Resolution
What was actually done to fix it. Link the deploy, manifest update, or PR.

## What went well
Specific, not generic.

## What went wrong / could be faster
Specific, blameless — describe the gap in the system or process, not a
person's mistake.

## Action items
| Action | Owner | Due date | Tracking issue |
|---|---|---|---|
| | | | |

## Lessons for the templates/process in docs/ops/incident/
Anything about this response that should change these templates,
severity definitions, or the disclosure timeline — feed it back before
the next tabletop exercise.
```
