# Template: Status Update

**Use when:** an incident is still open and it's time for the next scheduled
update (every 2–4 hours per [`README.md`](README.md#disclosure-timeline-target)),
or something material has changed (new finding, mitigation applied, scope
changed). Post even if the honest update is "no new information."

---

## Fill-in template

```
Title: [Update] <same short description as the initial notice>

Severity: <P0 | P1 | downgraded from X to Y, if applicable>
Status: <Investigating | Identified | Monitoring>
Incident started: <UTC timestamp>
This update: <UTC timestamp>

What's changed since the last update:
- <New findings, mitigations applied, or explicitly "No material change;
  investigation continues.">

Current impact:
- <Who/what is affected right now, stated plainly. Do not minimize; do not
  editorialize.>

What you should do:
- <Updated guidance — may be unchanged from initial notice.>

What you should NOT do:
- <Repeat the safety guidance from the initial notice; do not assume users
  saw it the first time.>

Next update by: <UTC timestamp, matching the disclosure-timeline cadence>

Follow this incident: <status page link>
```

---

## Notes for the comms lead

- If status moves from "Investigating" to "Identified" (root cause known, fix
  in progress) or "Monitoring" (fix applied, watching for recurrence), say so
  explicitly — these words carry meaning for integrators tracking incident
  state programmatically. See [`integrator-api-status.md`](integrator-api-status.md).
- If severity changes (up or down), call it out in the title and explain why
  in one sentence — do not silently re-label.
- If a fix requires a contract upgrade, cross-reference
  [`docs/MULTISIG_ADMIN.md`](../../MULTISIG_ADMIN.md) and note the expected
  downtime, if any, in this update.
