# @opaquecash/stellar

Stealth private payments, privacy pools, relayer-market submission, and on-chain
zero-knowledge reputation for [Stellar](https://stellar.org) / Soroban — in one
framework-free, typed, isomorphic (browser + Node) package.

> Status: pre-release (`0.x`). The crypto layer is implemented and tested; the
> chain, proving, and high-level client layers are landing incrementally.

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
| `@opaquecash/stellar` | umbrella (high-level client + everything, as layers land) |
| `@opaquecash/stellar/crypto` | isomorphic primitives, **no chain dependency** |

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
