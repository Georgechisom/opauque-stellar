# Changelog

All releases include a short changelog entry for the sections below. Breaking changes are explicitly marked and deployment manifests are linked from the release notes.

## Unreleased

### Frontend

- Added sanitized diagnostics export and inspection flow for privacy-safe troubleshooting.
- Added privacy-preserving error reporting with opt-in consent and redaction controls.
- Clarified support boundaries and docs around local-data recovery limits.

### Docs

- Added the support playbook and clarified recovery expectations.
- Documented the diagnostics export flow and privacy boundaries for support use.

### Contracts

- No contract changes in this patch.

### Circuits

- No circuit changes in this patch.

### Scanner

- No scanner changes in this patch.

### Deployments

- Deployment manifest: [deployments/README.md](deployments/README.md)

### Breaking changes

- None.

---

## 0.1.0

### Frontend

- Added the reference wallet UX for private receive, pool deposit, proof generation, and scan flows.

### Contracts

- Initial Soroban deployment set for the privacy pool, reputation verifier, and registry contracts.

### Circuits

- Initial Groth16 proof system and verification setup for privacy pool and reputation paths.

### Scanner

- Initial DKSAP scanner and browser-side receive discovery flow.

### Deployments

- Linked canonical deployment manifest and artifact pins in [deployments/README.md](deployments/README.md).

### Breaking changes

- Initial release; no prior compatibility guarantees.
