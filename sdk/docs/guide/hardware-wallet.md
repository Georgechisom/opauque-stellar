# Hardware wallet (Ledger)

Back an [`OpaqueSigner`](/reference/client) with a Ledger hardware device instead
of a raw in-memory keypair. Ledger's Stellar app is the only mainstream
hardware-wallet integration for Stellar; the approach below adapts it to
`callbackSigner` the same way [Freighter](/guide/browser) is adapted in the
browser.

## Read this before wiring it up

**The Ledger Stellar app cannot parse Soroban contract invocations.** It fully
parses and displays classic operations (payments, trustlines, account
merges), but every call this SDK makes — `deposit`, `withdraw`, `announce`,
`attest`, relayer job submission, all of it — is a Soroban
`invoke_host_function` operation. The device has no way to show the contract
id, method, or arguments being invoked.

To sign these transactions at all, the Ledger Stellar app must have **Hash
Signing** enabled in its settings, and it will sign the raw transaction hash
("blind signing") rather than a parsed, human-readable operation. Concretely:

- The device screen shows a hash, not "withdraw 5 XLM to G...". Approving the
  prompt means trusting the *host* (this code, and whatever built the XDR
  upstream of it) to have constructed the correct transaction — the hardware
  wallet gives you private-key custody isolation, not transaction-content
  verification, for any Soroban call.
- The one exception is a plain XLM payment (e.g. sweeping a detected stealth
  transfer via `payments.sweep`, which calls `sendNativeTransfer` under the
  hood) — that is a classic `Payment` operation and the device *can* parse and
  display it normally, without enabling hash signing.
- Mitigate the blind-signing gap by decoding and reviewing the XDR yourself
  (`TransactionBuilder.fromXDR`) immediately before requesting a signature —
  log the invoked contract id and args to a channel you trust — since the
  device cannot do this for you.

If that trust model does not fit your threat model, keep the signer for a
server-side keypair (see [Node](/guide/node)) and reserve the hardware wallet
for cold storage that never signs Soroban calls directly.

## Signer example

Requires `@ledgerhq/hw-transport-node-hid` and `@ledgerhq/hw-app-str`
(hardware-specific, so they are not SDK dependencies — install them yourself):

```sh
npm install @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-str
```

```ts
// ledger-signer.ts
import Transport from "@ledgerhq/hw-transport-node-hid";
import Str from "@ledgerhq/hw-app-str";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { callbackSigner, type OpaqueSigner } from "@opaquecash/stellar";

/**
 * Build an OpaqueSigner backed by a connected Ledger device.
 *
 * `path` is the SLIP-0010 derivation path (default: the first Stellar
 * account); `networkPassphrase` must match the `OpaqueClient` network this
 * signer is used with. Requires "Hash Signing" enabled in the Ledger Stellar
 * app's settings — every transaction the SDK submits is a Soroban contract
 * invocation the device cannot parse, so it falls back to signing the raw
 * hash. See the limitations above before using this in production.
 */
export async function ledgerSigner(opts: {
  networkPassphrase: string;
  path?: string;
}): Promise<OpaqueSigner> {
  const path = opts.path ?? "44'/148'/0'";
  const transport = await Transport.create();
  const str = new Str(transport);
  const { publicKey } = await str.getPublicKey(path);

  return callbackSigner({
    publicKey,
    // callbackSigner's signTransaction callback only receives the XDR, not a
    // ctx — the network passphrase must come from the closure instead.
    signTransaction: async (xdr) => {
      const tx = TransactionBuilder.fromXDR(xdr, opts.networkPassphrase);
      // Blind-signs tx.hash() — the device shows a hash, not the operation.
      const { signature } = await str.signHash(path, tx.hash());
      tx.addSignature(publicKey, signature.toString("base64"));
      return tx.toXDR();
    },
  });
}
```

```ts
// usage
import { OpaqueClient } from "@opaquecash/stellar";
import { ledgerSigner } from "./ledger-signer";

const networkPassphrase = "Test SDF Network ; September 2015";
const opaque = new OpaqueClient({
  network: "testnet",
  signer: await ledgerSigner({ networkPassphrase }),
});

const { note } = await opaque.pool.deposit({ amountXlm: "5" });
```

`str.signHash` needs "Hash Signing" turned on under the Ledger Stellar app's
settings on the device itself; it is off by default precisely because it lets
the device sign content it cannot display.

## Custom hardware backends

Any device that exposes "give me the public key" and "sign this hash/XDR"
fits the same shape — implement `OpaqueSigner` directly, or wrap your SDK in
`callbackSigner` as above. `signTransaction` receives the full transaction XDR
plus `{ networkPassphrase }`; you decide whether to sign the hash (blind) or
parse and re-render the operation for on-device display if your hardware
supports Soroban parsing.
