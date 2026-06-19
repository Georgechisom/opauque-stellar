# Security Model

## Trusted setup

The Groth16 proving and verification keys currently come from a **development
trusted-setup ceremony**. This is suitable for testnet and evaluation, not for
securing mainnet value. Before a mainnet deployment the circuits must go through
an audited multi-party computation (MPC) ceremony, and the embedded verification
keys must be regenerated from its output.

The SDK makes the swap a configuration change, not a code change: point an
[`ArtifactResolver`](/reference/client) at the new artifact set.

## Artifact integrity

Circuit `.wasm` / `.zkey` files are fetched at proof time, never bundled. A
production resolver should verify each artifact's SHA-256 against a pinned
manifest before use and refuse on mismatch (`ArtifactError`). The
`urlArtifactResolver` / `fileArtifactResolver` helpers resolve locations; layer
integrity checking on top for untrusted sources.

## Key handling

- `keypairSigner` holds a private key in memory — use it on servers, not in the
  browser. In the browser use `callbackSigner` with a wallet so the SDK never
  sees a key.
- Derived stealth and announcer keys live only for the duration of an operation.
- The SDK logs nothing by default; if you wire a `Logger`, ensure it does not
  capture secrets.

## Network surface

The SDK only contacts the RPC, Horizon, relayer-gateway, reputation-publisher,
and artifact hosts you configure. There are no hidden endpoints.

## Privacy caveats

- **Pool state root** is published by a trusted (admin) publisher in the current
  design — see [Privacy Pool](/concepts/privacy-pool).
- **Relayer job funding** is a public transaction; fund jobs from an address
  unrelated to your main identity — see [Relayer Market](/concepts/relayer-market).
- A withdrawal is public on-chain; the relayer market hides *who submits it*, not
  the withdrawal itself.

## Reporting

Report vulnerabilities through the repository's security policy rather than
public issues.
