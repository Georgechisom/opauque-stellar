# Technical Overview

Opaque Stellar is a privacy protocol built from small, auditable pieces. The wallet stays non-custodial, contracts enforce state transitions on Soroban, and proofs are generated off-chain before being verified on-chain.

## System Components

| Component | Path | Responsibility |
| --- | --- | --- |
| Stealth registry | `contracts/stealth-registry` | Stores recipient meta-addresses used for private receives. |
| Stealth announcer | `contracts/stealth-announcer` | Records payment announcements and view tags for scanner discovery. |
| Scanner | `scanner/` | Rust DKSAP scanner compiled to WASM for browser-side receive detection. |
| Privacy pool | `contracts/privacy-pool` | Holds deposits, verifies withdrawal proofs, records nullifiers, and enforces custody. |
| Pool verifier | `contracts/groth16-verifier` | Verifies the v3 privacy-pool Groth16 proof. |
| ASP | `asp/` | Rebuilds approved association-set roots and pool state roots from public events. |
| Relayer registry | `contracts/relayer-registry` | Tracks relayer operators, X25519 public keys, endpoints, stake, jobs, bids, and settlement. |
| Relayer | `relayer/` | Runs the HTTP gateway, shared hub, node engine, encrypted payload handling, and submission loop. |
| Reputation verifier | `contracts/reputation-verifier` | Verifies reputation roots, nullifiers, and Groth16 public inputs. |
| Frontend wallet | `frontend/` | Freighter integration, local scanning, proof generation, pool operations, and relayer selection. |

## Stealth Payments

Recipients publish a meta-address containing spend and view material. A sender derives an ephemeral shared secret, creates a one-time Stellar account, sends XLM to that account, and announces enough metadata for the recipient to find it.

The recipient's browser scanner filters announcements by view tag, reconstructs the one-time private key, and sweeps the account. The recipient's main wallet does not appear as the payment destination.

The important boundary is that scanning is local. The protocol does not require a hosted scanner to learn which outputs belong to a user.

## Privacy Pool

The privacy pool separates deposit identity from withdrawal identity.

1. The user creates a private note and deposits XLM under a commitment.
2. Deposit events become leaves in the pool state tree.
3. The ASP publishes an association-set root over approved labels.
4. The ASP also publishes the state root reconstructed from public deposit and withdrawal events.
5. The wallet rebuilds the relevant paths, checks the published roots, and generates a Groth16 proof.
6. The contract verifies the proof, records the nullifier, enforces the custody invariant, and releases XLM.

The v3 withdrawal proof binds the recipient, withdrawn amount, fee, relayer address, and pool scope into the public context. A relayer can submit the transaction, but it cannot change where funds go or how much is paid.

## Association Set Provider

The ASP is a curation and liveness service. It decides which deposits are part of the approved association set and publishes the root used by withdrawal proofs.

For the MVP demo, the policy is `approveAll`, so every testnet deposit is approved. This makes the ASP primarily a root publisher for demo liveness.

The ASP cannot mint funds, steal deposits, forge proofs, or bypass nullifier checks. If it publishes a bad association list, the wallet's locally reconstructed root will not match and proof generation fails. If it publishes a state root that does not match public pool events, clients can detect the mismatch by rebuilding from chain history.

## Relayer Market

The relayer market removes the last wallet-linking step from pool withdrawal.

1. A relayer registers on-chain with an operator account, X25519 public key, endpoint, and stake.
2. A wallet creates an escrowed job in the relayer registry and publishes a blind job advert to the gateway.
3. Relayers inspect the on-chain job and bid only when they are registered, have a matching public key, and have enough free stake to cover the fee.
4. The wallet selects a valid bid and sends an encrypted payload to the gateway.
5. The winning relayer decrypts the payload, submits the privacy-pool withdrawal, and earns the escrowed fee.

The fee cannot exceed the relayer's free stake. This protects users from bids that cannot be backed by the registered operator.

The intended production shape is a shared public gateway acting as the gossip hub. Wallets talk to that gateway from the manifest, while relayer nodes connect to it and compete without requiring users to manually paste operator URLs.

## ZK Reputation

Opaque reputation uses attestations and Groth16 proofs to prove a trait without linking it to a public wallet.

An issuer creates an attestation under a schema. The holder proves membership in a Poseidon Merkle tree and submits public inputs to the reputation verifier. The contract checks root validity, nullifier replay protection, and Groth16 verification through the verifier contract.

## Manifests And Artifact Pinning

The frontend and services read deployment data from `deployments/v1/<network>.json`. Contract IDs, WASM hashes, RPC URLs, relayer registry config, and circuit artifact hashes are not hardcoded across the app.

Artifact integrity is checked by:

```bash
npm run verify:deployment
npm run verify:artifacts
```

## Trust Boundaries

| Actor | Can do | Cannot do |
| --- | --- | --- |
| Sender | Send to a stealth-derived account. | Derive the recipient's spend key. |
| Recipient | Scan and sweep matching receives. | Hide network metadata from their own browser or RPC provider by default. |
| ASP | Publish approved roots and state roots. | Mint funds, bypass proof verification, or spend user notes. |
| Relayer | Submit a selected encrypted withdrawal payload. | Change recipient, amount, fee, nullifier, or proof context. |
| Issuer | Issue or revoke attestations under its authority. | Prove a holder's private reputation statement without the holder's witness. |
| Contracts | Enforce roots, proofs, nullifiers, custody, and escrow. | Decide off-chain policy or protect users from compromised local devices. |

## Current Limits

The current deployment is a testnet MVP. The ASP uses approve-all policy, the relayer is demo-operated, and mainnet remains blocked until the security register is signed off. Circuit artifacts use a development setup and should be replaced with a production ceremony before mainnet.

For browser key storage risks, read [GHOST_THREAT_MODEL.md](GHOST_THREAT_MODEL.md).
