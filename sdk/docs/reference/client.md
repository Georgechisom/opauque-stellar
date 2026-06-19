# OpaqueClient

The high-level entry point. One config + one signer wires the network, RPC
client, contract bindings, storage, and the domain services.

## Construction

```ts
new OpaqueClient({
  network: "testnet" | "mainnet" | "futurenet" | "local",
  signer?: OpaqueSigner,            // required for writes
  rpcUrls?: string[],               // default: network preset
  horizonUrls?: string[],           // default: network preset
  contracts?: Partial<ContractAddresses>,   // override baked addresses
  relayerGatewayUrls?: string[],
  artifacts?: ArtifactResolver,     // enables proof generation
  storage?: { notes?, vault?, scan? },       // default: in-memory
  logger?: Logger,                  // default: silent
  telemetry?: Telemetry,            // default: no-op
})
```

Testnet contract addresses, pool scope, and relayer parameters are baked in.
Mainnet requires explicit `rpcUrls`, `horizonUrls`, and `contracts`.

## Signers

| Adapter | Use |
|---------|-----|
| `keypairSigner(secretOrKeypair)` | server / Node |
| `callbackSigner({ publicKey, signTransaction })` | Freighter or any wallet |

## Services

### `payments`
- `deriveIdentity(signatureHex)` — viewing/spending keys + meta-address
- `register({ metaAddress })`
- `prepareTransfer(metaHex)` — one-time address + announcement params
- `send({ to, amountXlm })`
- `scan({ announcements, identity })` — pure-TS, returns matches
- `sweep({ stealthPrivKey, destination, amountStroops })`

### `pool`
- `deposit({ amountXlm })` — reads index, derives commitment, persists note
- `withdraw({ proof, recipient, fee?, relayer?, noteCommitment? })`
- `proveWithdraw({ note, recipient, stateLeaves, depositIndices, … })` *(needs `artifacts`)*
- `getDepositCount()`, `getRoots()`

### `reputation`
- `attest({ schemaId, stealthAddressHash, fieldValues, fieldDefinitions, … })`
- `prove({ attestationId, stealthPrivKey, externalNullifier })` *(needs `artifacts`)*
- `verifyOnChain(proof)` — submit to `reputation-verifier`
- `proveAndVerify(input)`
- `getLatestRoot()`

### `schemas`
- `register({ name, fieldDefinitions, revocable, schemaExpiryLedger, … })`
- `attest(…)`, `revoke({ uid })`, `deprecate({ schemaId })`
- `addDelegate(…)`, `removeDelegate(…)`

### `relayer`
- `createJob({ jobId, payloadHash, deadlineLedger, fee })`
- `cancelJob({ jobId })`, `slashJob({ jobId })`

## Escape hatches

```ts
opaque.contracts.privacyPool;  // typed contract bindings
opaque.rpc;                    // ContractInvoker
opaque.soroban;                // built-in RpcClient (Soroban + Horizon), or undefined
```

## Errors

All errors extend `OpaqueError` with a stable `code`: `ConfigError`,
`SignerError`, `RpcError`, `SimulationError`, `ContractError` (carries
`contract` + `contractCode`), `RootUnavailableError`, `ArtifactError`,
`NotWiredError`.
