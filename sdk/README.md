# @opaquecash/stellar

Stealth private payments, privacy pools, relayer-market submission, and on-chain
zero-knowledge reputation for [Stellar](https://stellar.org) / Soroban — in one
framework-free, typed, isomorphic (browser + Node) package.

> Status: pre-release (`0.x`). Crypto, config, signer, RPC, contract bindings,
> domain services, the high-level `OpaqueClient`, and Groth16 proof generation
> (reputation + pool) are implemented and tested — proving requires circuit
> artifacts via an `ArtifactResolver`. Announcement scanning works in pure TS.
> Not yet wired (throw `NotWiredError`): the relayer **gateway** message flow.
> Pool withdrawal currently takes the reconstructed pool leaves from the caller.

## Install

```sh
npm install @opaquecash/stellar
```

Peer dependencies (install the ones your usage needs):

```sh
npm install @stellar/stellar-sdk @noble/curves @noble/hashes
# pool / reputation proving:
npm install circomlibjs snarkjs
# relayer market:
npm install tweetnacl
```

## Subpath exports

The package is tree-shakeable; import the narrowest surface you need.

| Import | Contents |
|--------|----------|
| `@opaquecash/stellar` | umbrella: `OpaqueClient`, services, bindings, config, signer |
| `@opaquecash/stellar/crypto` | isomorphic primitives, **no chain dependency** |

## High-level client

```ts
import { OpaqueClient, keypairSigner } from "@opaquecash/stellar";

// Server-side with a raw keypair (browser apps pass a Freighter-backed signer).
const opaque = new OpaqueClient({
  network: "testnet",                       // testnet addresses are baked in
  signer: keypairSigner(process.env.SECRET!),
});

// Stealth payments
const id = opaque.payments.deriveIdentity(walletSignatureHex);
await opaque.payments.register({ metaAddress: id.metaAddress });
await opaque.payments.send({ to: recipientMetaHex, amountXlm: "10" });

// On-chain ZK reputation (bring a precomputed proof until the prover lands)
await opaque.reputation.verifyOnChain(proofBundle);

// Privacy pool
const { note } = await opaque.pool.deposit({ amountXlm: "5" });
await opaque.pool.withdraw({ proof, recipient, noteCommitment: note.commitment });

// Schema administration
const { schemaId } = await opaque.schemas.register({
  name: "credit", fieldDefinitions: "u64 score, bool verified",
  revocable: true, schemaExpiryLedger: 5_000_000,
});

// Escape hatches
opaque.contracts.privacyPool;  // typed contract bindings
opaque.soroban;                // built-in RpcClient (Soroban + Horizon)
```

Override any default (RPC URLs, contract addresses, gateways) via the constructor;
plug your own `NoteStore`/`VaultStore`/`ScanStore`, `Logger`, and `Telemetry`.

## Crypto layer (available now)

```ts
import {
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  computeStealthAddressAndViewTag,
  checkViewTagMatch,
  reconstructStealthPrivateKey,
  deriveStealthStellarKeypairFromStealthPrivKey,
} from "@opaquecash/stellar/crypto";

// Recipient: derive a stealth meta-address from a wallet signature.
const { viewingKey, spendingKey } = deriveKeysFromSignature(walletSignatureHex);
const { metaAddress } = keysToStealthMetaAddress(viewingKey, spendingKey);
const metaHex = stealthMetaAddressToHex(metaAddress);

// Sender: derive a one-time stealth address + the Stellar account that receives funds.
const send = computeStealthAddressAndViewTag(metaHex);
// -> send.stealthStellarAddress is the G-address to pay.

// Recipient: detect (cheap) then reconstruct the spending key.
if (checkViewTagMatch({ viewingKey, ephemeralPubKey: send.ephemeralPubKey, viewTag: send.viewTag })) {
  const stealthPriv = reconstructStealthPrivateKey({
    viewingKey,
    spendingKey,
    ephemeralPubKey: send.ephemeralPubKey,
  });
  const keypair = deriveStealthStellarKeypairFromStealthPrivKey(stealthPriv);
  // keypair.publicKey() === send.stealthStellarAddress
}
```

Also in `crypto`: privacy-pool note derivation (`deriveDeposit`, `newNoteSecrets`),
schema / attestation codecs (`computeSchemaId`, `encodeAttestationData`), encrypted
backups (`encryptGhostEntries`), payment links (`createPaymentLink`), and memo
validation (`validateMemo`).

## License

MIT
