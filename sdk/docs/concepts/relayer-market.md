# Relayer Market

A privacy-pool withdrawal is a public on-chain transaction. If the account that
owns the UI session submits it, that account is linked to the withdrawal. The
relayer market removes this leak: a **staked third-party relayer** submits the
withdrawal on the user's behalf.

## How it works

1. The user generates the withdrawal proof but builds a **signerless payload**
   instead of submitting it.
2. The user creates an on-chain **job** with the payload's hash, a fee escrow,
   and a deadline (`relayer-registry.create_job`).
3. The user advertises the job, collects bids, and **encrypts the payload** to
   the chosen relayer's registered X25519 key.
4. The relayer decrypts, hash-checks, simulates, accepts (bonding stake), and
   submits the pool withdrawal. The escrowed fee pays the relayer.

The withdrawal proof binds recipient, amount, fee, relayer, and scope, so the
relayer **cannot alter** any of them. The payload stays hidden until submission.
The remaining linkage is the public job-funding transaction — fund it from an
address unrelated to your main identity.

## What a relayer can and cannot learn

- **Cannot**: change the recipient, amount, or proof; see the payload before
  accepting.
- **Can**: see the final withdrawal on-chain (it is public) and the
  job-funding wallet.

## SDK support

The full flow is available — build the blind payload, escrow the job, advertise,
pick a verified relayer, and deliver the encrypted payload:

```ts
// 1. build the blind payload from a withdrawal proof
const payload = opaque.relayer.buildWithdrawPayload({ proof, recipient });
const deadlineLedger = await opaque.relayer.deadlineLedger();
const draft = opaque.relayer.buildJobDraft({ payload, fee, deadlineLedger });

// 2. escrow the job on-chain (connected wallet) and advertise it
await opaque.relayer.createJobForDraft(draft);
await opaque.relayer.advertise(draft);

// 3. collect verified bids (signature + on-chain registry state), pick one
const bids = await opaque.relayer.fetchBids(draft.jobIdHex);
const bid = opaque.relayer.pickBid(bids);

// 4. encrypt the payload to the relayer and deliver it
await opaque.relayer.deliverPayload({ draft, bid: bid! });

// recovery
await opaque.relayer.cancelJob({ jobId: draft.jobId }); // after deadline, if unaccepted
await opaque.relayer.slashJob({ jobId: draft.jobId });   // after deadline, if accepted but unsubmitted
```

Payload encryption uses NaCl `crypto_box` (the optional `tweetnacl` peer
dependency). The wire format and gateway client are also exported standalone from
[`@opaquecash/stellar/relayer-protocol`](/reference/client) for relayer operators.
