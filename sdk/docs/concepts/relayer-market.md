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

The on-chain job lifecycle is available today:

```ts
await opaque.relayer.createJob({ jobId, payloadHash, deadlineLedger, fee });
await opaque.relayer.cancelJob({ jobId }); // after deadline, if never accepted
await opaque.relayer.slashJob({ jobId });  // after deadline, if accepted but unsubmitted
```

The gateway message flow (advert / bid / encrypted-payload delivery) is not yet
bundled in the SDK and throws `NotWiredError` from `relayer.useGateway()`.
