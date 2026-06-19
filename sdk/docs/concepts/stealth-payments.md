# Stealth Payments (DKSAP)

Stealth payments let a sender pay a recipient at a fresh, unlinkable address each
time, derived from a single published meta-address. The SDK implements the
Dual-Key Stealth Address Protocol (DKSAP) over secp256k1, byte-compatible with
the Rust WASM scanner.

## Keys

A recipient derives two keys from one wallet signature (HKDF-SHA256):

- a **viewing key** (detects incoming transfers), and
- a **spending key** (controls the funds).

The **meta-address** is `compressed(V) ‖ compressed(S)` (66 bytes), published as
`0x`-hex and registered on the `stealth-registry` contract.

## Sending

For each payment the sender:

1. generates an ephemeral keypair and an ECDH shared secret with the recipient's
   viewing key,
2. derives a one-time stealth point `P_stealth = P_spend + keccak(secret)·G`,
3. computes a **view tag** (first byte of the hashed secret) for cheap scanning,
   and
4. funds a **deterministic Ed25519 Stellar account** derived from `P_stealth`
   (`sha256("opaque-stellar-stealth-v1" ‖ uncompressed(P_stealth))`).

The sender also publishes an announcement (20-byte stealth id, ephemeral public
key, view tag) on the `stealth-announcer` contract.

```ts
const transfer = opaque.payments.prepareTransfer(recipientMetaHex);
// transfer.stealthStellarAddress receives the XLM
```

## Scanning

The recipient view-tag-prefilters announcements, then reconstructs the one-time
private key `s + keccak(secret) (mod n)` and confirms the stealth id matches.
This is pure TypeScript in the SDK — no WASM required:

```ts
const matches = opaque.payments.scan({ announcements, identity });
// each match has stealthPrivKey + stealthStellarAddress
```

The reconstructed key derives the same Stellar account, which the recipient
sweeps to a destination of their choice — breaking the on-chain link between
sender and recipient.
