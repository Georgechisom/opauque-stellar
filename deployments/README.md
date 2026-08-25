# Deployments

**This folder is the on-chain address book for Opaque Stellar.**

When you run `npm run deploy:testnet`, the deploy script writes every Soroban contract ID, WASM hash, and network URL into `v1/testnet.json` (or `mainnet.json`). The frontend reads that file at build time — no hardcoded addresses in source code.

| File | Purpose |
|------|---------|
| `v1/testnet.json` | Testnet contract IDs + artifact hashes |
| `v1/mainnet.json` | Mainnet record (requires audit signoff to deploy) |
| `manifest.schema.json` | JSON schema CI validates against |
| `security/mainnet-audit-findings.json` | Mainnet deploy gate (blocking findings) |

After deploying, commit the updated manifest so CI and other developers stay in sync.

`wasmHash` in each manifest is verified against a from-source rebuild inside a pinned, checksum-verified Docker image on every PR touching `contracts/**` — see [docs/REPRODUCIBLE_BUILDS.md](../docs/REPRODUCIBLE_BUILDS.md).
