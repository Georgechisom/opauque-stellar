# Upgrade Governance

This document describes how deployed Soroban contracts can be upgraded, who has authority to perform upgrades, and what guarantees users can rely on.

## Overview

Soroban contracts are upgradeable via the built-in `upgrade()` host function. The deployer account (or a delegated multisig) signs the upgrade transaction, replacing the contract's WASM binary while preserving its address and storage. This is a deliberate design choice: it allows bug fixes and feature additions without requiring users to migrate to new contract addresses.

## Upgrade Authority

Each contract's upgrade authority is the **deployer account** or a **delegated multisig** that controls the contract address. The authority is set at deployment time and is not stored on-chain — it is derived from Stellar account ownership.

| Contract | Upgrade Authority | Mechanism |
| --- | --- | --- |
| `groth16-verifier` | Deployer / multisig | `upgrade()` host function |
| `privacy-pool` | Deployer / multisig | `upgrade()` host function |
| `reputation-verifier` | Deployer / multisig | `upgrade()` host function |
| `attestation-engine-v2` | Deployer / multisig | `upgrade()` host function; `upgrade_info` field in `GovernanceConfig` for metadata |
| `schema-registry` | Deployer / multisig | `upgrade()` host function |
| `relayer-registry` | Deployer / multisig | `upgrade()` host function |
| `stealth-announcer` | Deployer / multisig | `upgrade()` host function |
| `stealth-registry` | Deployer / multisig | `upgrade()` host function |

### Governance Model

The `attestation-engine-v2` contract has a two-key governance model with separate `admin` and `governance` roles. Both roles can:
- Update configuration (including `upgrade_info` metadata)
- Pause/unpause individual contract features (attestation, merkle updates, proof verification)

The `upgrade_info` field is an opaque blob that can store deployment context for off-chain tooling. It does not affect on-chain behavior.

## Upgrade Process

1. **Prepare** the new WASM binary. The binary must be compiled from the same source with compatible storage layouts.
2. **Review** the upgrade for storage compatibility. Migrations run lazily on first access after an upgrade.
3. **Submit** the upgrade transaction signed by the deployer account (or multisig).
4. **Verify** by calling `version()` on each contract to confirm the new version is active.

## Migration Strategy

Storage migrations are handled lazily. Each storage key type documents its migration path in the contract source. When a contract is upgraded:

- Existing storage keys are preserved.
- New storage keys may be added.
- The first access to a migrated key triggers the migration logic.
- Older storage written by a previous version remains but is ignored by the rollback binary if a rollback occurs.

## Rollback

Rollback is performed by re-deploying the previous WASM hash via `upgrade()`. Storage written by the newer version remains on-chain but is ignored by the rolled-back binary. This is safe because storage keys are versioned by the contract's internal schema.

## Client Inspection

Clients can inspect the current version by calling `version()` on each contract. The deployment manifest (`deployments/v1/<network>.json`) records the expected WASM hash and version for each network. Frontend validation (`EXPECTED_MAJOR_VERSION`) prevents interaction with contracts whose major version does not match.

## Immutable Components

The following components are **not** upgradeable and are fixed at deployment:

- **Circuit verification keys** (`VK_ALPHA`, `VK_BETA`, etc.) are compile-time constants in the `groth16-verifier` contract. Changing them requires a full contract redeployment (new address).
- **Circuit constraints** in `circuits/` are fixed by the trusted setup. Changing the proof system requires a new circuit, new verification keys, and a new verifier contract.
- **Event schema versions** (`EVENT_VERSION`) are compile-time constants. Changing the event ABI is a breaking change that requires coordination with scanners and indexers.

## User-Visible Guarantees

- **Address stability**: Contract addresses never change across upgrades.
- **Storage persistence**: All on-chain state (nullifiers, commitments, roots, attestations) is preserved across upgrades.
- **Authorization preservation**: Admin and governance roles set at initialization are preserved unless explicitly changed by a governance action.
- **Proof compatibility**: Existing valid proofs continue to work after an upgrade, unless the upgrade changes the verification key (which constitutes a new contract deployment).

## Security Considerations

- Upgrade authority is a critical trust assumption. Users must trust that the deployer/multisig will not deploy malicious code.
- The `upgrade_info` field in `attestation-engine-v2` is opaque and does not affect on-chain behavior, but clients should not rely on it for security decisions.
- Emergency pause mechanisms (per-feature pauses in `attestation-engine-v2`) can halt specific contract functions without requiring an upgrade.

## References

- [Soroban Documentation: Contract Upgrades](https://soroban.stellar.org/docs/learn/soroban-and-smart-contracts/upgrading-contracts)
- [ADR-0005: Soroban Privacy Pool](adr/0005_soroban_privacy_pool.md) — documents upgrade coordination as a negative consequence
- [ADR-0001: Off-Chain Published Roots](adr/0001_off_chain_published_roots.md) — policy changes can deploy without contract upgrade
- [frontend/src/lib/contractVersion.ts](../frontend/src/lib/contractVersion.ts) — `UPGRADE_NOTES` constant with upgrade/rollback/inspection details
