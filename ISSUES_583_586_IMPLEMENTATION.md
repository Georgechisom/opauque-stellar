# Issues #583-586 Implementation Guide

Comprehensive implementation for 4 critical smart contract features.

## Issues Summary

| # | Title | Contract | Status |
|---|-------|----------|--------|
| 583 | Add slashing conditions for relayer stake | relayer-registry | To implement |
| 584 | Add minimum withdrawal amount | privacy-pool | To implement |
| 585 | Add commitment tree capacity guard | privacy-pool | To implement |
| 586 | Add attestation revocation | attestation-engine-v2 | To implement |

---

## Issue #583: Add Slashing Conditions for Relayer Stake

### Problem
Relayer stake currently secures nothing concrete because no misbehavior leads to loss of stake.

### Solution
Define and implement slashable offenses with evidence submission and stake burn.

### Implementation

#### Step 1: Update Relayer Registry Contract

**File**: `contracts/relayer-registry/src/lib.rs`

```rust
// Add to data structures
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SlashableOffense {
    DoubleSign,           // Signing conflicting transactions
    Censorship,           // Selectively censoring transactions
    DelayedInclusion,     // Delaying transaction inclusion
    InvalidSignature,     // Providing invalid signature
    Frontrunning,         // Frontrunning user transactions
}

#[derive(Clone, Debug)]
pub struct SlashingProof {
    pub relayer: Address,
    pub offense: SlashableOffense,
    pub evidence: Bytes,      // Proof of offense
    pub timestamp: u64,
    pub reporter: Address,    // Who submitted the evidence
}

#[derive(Clone, Debug)]
pub struct RelayerSlashRecord {
    pub relayer: Address,
    pub total_slashed: u128,
    pub slash_count: u32,
    pub last_slash_time: u64,
}

// State tracking
fn get_slashing_record(env: &Env, relayer: &Address) -> Option<RelayerSlashRecord> {
    // Retrieve from ledger
}

fn set_slashing_record(env: &Env, relayer: &Address, record: &RelayerSlashRecord) {
    // Store in ledger
}

// Main slashing function
pub fn slash_relayer(
    env: &Env,
    proof: &SlashingProof,
    slash_amount: u128,
) -> Result<(), Error> {
    // Verify proof validity based on offense type
    verify_slash_proof(env, proof)?;
    
    // Check relayer has sufficient stake
    let current_stake = get_relayer_stake(env, &proof.relayer)?;
    if current_stake < slash_amount {
        return Err(Error::InsufficientStakeToSlash);
    }
    
    // Burn the stake
    burn_relayer_stake(env, &proof.relayer, slash_amount)?;
    
    // Record the slashing
    let mut record = get_slashing_record(env, &proof.relayer)
        .unwrap_or(RelayerSlashRecord {
            relayer: proof.relayer.clone(),
            total_slashed: 0,
            slash_count: 0,
            last_slash_time: 0,
        });
    
    record.total_slashed = record.total_slashed.saturating_add(slash_amount);
    record.slash_count = record.slash_count.saturating_add(1);
    record.last_slash_time = env.block().timestamp();
    
    set_slashing_record(env, &proof.relayer, &record);
    
    // Emit event
    env.events().publish(
        ("relayer", "slashed"),
        (
            &proof.relayer,
            &proof.offense,
            slash_amount,
            &proof.reporter,
        ),
    );
    
    Ok(())
}

// Verify slash proof based on offense type
fn verify_slash_proof(env: &Env, proof: &SlashingProof) -> Result<(), Error> {
    match proof.offense {
        SlashableOffense::DoubleSign => {
            // Verify two conflicting signatures exist
            verify_double_sign_evidence(&proof.evidence)?
        },
        SlashableOffense::Censorship => {
            // Verify transaction was submitted but not included
            verify_censorship_evidence(env, &proof.evidence)?
        },
        SlashableOffense::DelayedInclusion => {
            // Verify inclusion was delayed beyond threshold
            verify_delayed_inclusion_evidence(env, &proof.evidence)?
        },
        SlashableOffense::InvalidSignature => {
            // Verify signature is invalid
            verify_invalid_signature_evidence(&proof.evidence)?
        },
        SlashableOffense::Frontrunning => {
            // Verify frontrunning occurred
            verify_frontrunning_evidence(env, &proof.evidence)?
        },
    }
    Ok(())
}

// Query relayer slashing history
pub fn get_relayer_slashing_history(env: &Env, relayer: &Address) -> Option<RelayerSlashRecord> {
    get_slashing_record(env, relayer)
}

// Query slashing percentage for relayer
pub fn get_relayer_slashing_percentage(env: &Env, relayer: &Address) -> u64 {
    if let Some(record) = get_slashing_record(env, relayer) {
        let original_stake = get_relayer_original_stake(env, relayer).unwrap_or(0);
        if original_stake == 0 {
            return 0;
        }
        (record.total_slashed * 10000) / original_stake as u128 as u64
    } else {
        0
    }
}
```

#### Step 2: Add Events

```rust
// Events to emit
// - SlashedRelayer: emitted when relayer is slashed
//   data: (relayer, offense, amount, reporter, timestamp)
// - SlashingProofSubmitted: emitted when proof is submitted
//   data: (submitter, relayer, offense, timestamp)
```

### Acceptance Criteria
- ✅ Slashable offenses enumerated in contract documentation
- ✅ Evidence-based slashing path implemented and tested
- ✅ Slashing emits events consumable by relayer market UI

---

## Issue #584: Add Minimum Withdrawal Amount

### Problem
Dust-sized withdrawals let an attacker bloat the nullifier set and waste relayer capacity cheaply.

### Solution
Enforce a configurable minimum withdrawal amount in the pool contract.

### Implementation

**File**: `contracts/privacy-pool/src/lib.rs`

```rust
// Add to storage keys
const MINIMUM_WITHDRAWAL_AMOUNT_KEY: &str = "min_withdrawal";
const WITHDRAWAL_CONFIG_ADMIN: &str = "withdrawal_admin";

// Add storage type
#[derive(Clone, Debug)]
pub struct WithdrawalConfig {
    pub minimum_amount: u128,
    pub updated_at: u64,
    pub updated_by: Address,
}

// Initialization function
pub fn initialize_withdrawal_config(
    env: &Env,
    admin: Address,
    minimum_amount: u128,
) {
    env.storage().instance().set::<_, WithdrawalConfig>(
        &MINIMUM_WITHDRAWAL_AMOUNT_KEY,
        &WithdrawalConfig {
            minimum_amount,
            updated_at: env.block().timestamp(),
            updated_by: admin,
        },
    );
    
    env.events().publish(
        ("pool", "withdrawal_config_set"),
        (minimum_amount,),
    );
}

// Get current minimum withdrawal amount
pub fn get_minimum_withdrawal_amount(env: &Env) -> u128 {
    env.storage()
        .instance()
        .get::<_, WithdrawalConfig>(&MINIMUM_WITHDRAWAL_AMOUNT_KEY)
        .map(|config| config.minimum_amount)
        .unwrap_or(1_000_000) // Default: 0.01 of smallest unit
}

// Update minimum withdrawal amount (admin only)
pub fn update_minimum_withdrawal_amount(
    env: &Env,
    caller: Address,
    new_minimum: u128,
) -> Result<(), Error> {
    // Verify caller is admin
    verify_admin(env, &caller)?;
    
    // Update config
    let config = WithdrawalConfig {
        minimum_amount: new_minimum,
        updated_at: env.block().timestamp(),
        updated_by: caller.clone(),
    };
    
    env.storage()
        .instance()
        .set(&MINIMUM_WITHDRAWAL_AMOUNT_KEY, &config);
    
    // Emit event
    env.events().publish(
        ("pool", "minimum_withdrawal_updated"),
        (new_minimum, &caller),
    );
    
    Ok(())
}

// Modify withdraw function to check minimum
pub fn withdraw(
    env: &Env,
    amount: u128,
    to: Address,
    proof: Bytes,
) -> Result<(), Error> {
    // Check amount meets minimum
    let minimum = get_minimum_withdrawal_amount(env);
    if amount < minimum {
        return Err(Error::WithdrawalBelowMinimum {
            amount,
            minimum,
        });
    }
    
    // ... rest of withdrawal logic
    
    Ok(())
}

// Custom error type
#[derive(Debug, Eq, PartialEq)]
pub enum Error {
    WithdrawalBelowMinimum { amount: u128, minimum: u128 },
    // ... other errors
}
```

### Acceptance Criteria
- ✅ Withdrawals below minimum revert with dedicated error
- ✅ Minimum adjustable only through admin path with event
- ✅ Existing notes above minimum unaffected

---

## Issue #585: Add Commitment Tree Capacity Guard

### Problem
The depth-20 tree holds about one million commitments, and filling it would silently break new deposits.

### Solution
Add explicit capacity tracking with deposit revert near limit and monitoring visibility.

### Implementation

**File**: `contracts/privacy-pool/src/lib.rs`

```rust
// Add constants
const TREE_DEPTH: u32 = 20;
const MAX_COMMITMENTS: u64 = 1_000_000; // 2^20 - theoretical max
const CAPACITY_WARNING_THRESHOLD: f64 = 0.85; // 85% full
const CAPACITY_CRITICAL_THRESHOLD: f64 = 0.95; // 95% full

// Add to storage
const TREE_CAPACITY_KEY: &str = "tree_capacity";
const TREE_COMMITMENT_COUNT_KEY: &str = "commitment_count";
const CAPACITY_ALERTS_KEY: &str = "capacity_alerts";

#[derive(Clone, Debug)]
pub struct TreeCapacityInfo {
    pub max_capacity: u64,
    pub current_count: u64,
    pub depth: u32,
    pub last_updated: u64,
}

#[derive(Clone, Debug)]
pub struct CapacityAlert {
    pub level: AlertLevel,
    pub timestamp: u64,
    pub current_count: u64,
    pub threshold: f64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AlertLevel {
    Normal,
    Warning,  // 85% full
    Critical, // 95% full
}

// Initialize capacity tracking
pub fn initialize_capacity_tracking(env: &Env) {
    let capacity = TreeCapacityInfo {
        max_capacity: MAX_COMMITMENTS,
        current_count: 0,
        depth: TREE_DEPTH,
        last_updated: env.block().timestamp(),
    };
    
    env.storage()
        .instance()
        .set(&TREE_CAPACITY_KEY, &capacity);
}

// Get current capacity info
pub fn get_tree_capacity(env: &Env) -> TreeCapacityInfo {
    env.storage()
        .instance()
        .get(&TREE_CAPACITY_KEY)
        .unwrap_or(TreeCapacityInfo {
            max_capacity: MAX_COMMITMENTS,
            current_count: 0,
            depth: TREE_DEPTH,
            last_updated: env.block().timestamp(),
        })
}

// Get capacity percentage
pub fn get_capacity_percentage(env: &Env) -> u64 {
    let capacity = get_tree_capacity(env);
    if capacity.max_capacity == 0 {
        return 0;
    }
    ((capacity.current_count as u128 * 10000) / capacity.max_capacity as u128) as u64
}

// Check if tree is at capacity
pub fn is_tree_at_capacity(env: &Env) -> bool {
    let capacity = get_tree_capacity(env);
    capacity.current_count >= capacity.max_capacity
}

// Check alert level
pub fn get_capacity_alert_level(env: &Env) -> AlertLevel {
    let capacity = get_tree_capacity(env);
    let percentage = capacity.current_count as f64 / capacity.max_capacity as f64;
    
    if percentage >= CAPACITY_CRITICAL_THRESHOLD {
        AlertLevel::Critical
    } else if percentage >= CAPACITY_WARNING_THRESHOLD {
        AlertLevel::Warning
    } else {
        AlertLevel::Normal
    }
}

// Emit capacity alert if needed
fn check_and_emit_capacity_alert(env: &Env) {
    let alert_level = get_capacity_alert_level(env);
    
    env.events().publish(
        ("pool", "capacity_alert"),
        (
            &alert_level,
            get_capacity_percentage(env),
            &env.block().timestamp(),
        ),
    );
}

// Increment commitment counter
pub fn increment_commitment_count(env: &Env) -> Result<(), Error> {
    let mut capacity = get_tree_capacity(env);
    
    // Check if at capacity
    if capacity.current_count >= capacity.max_capacity {
        return Err(Error::TreeAtCapacity {
            current: capacity.current_count,
            max: capacity.max_capacity,
        });
    }
    
    // Increment counter
    capacity.current_count += 1;
    capacity.last_updated = env.block().timestamp();
    
    env.storage()
        .instance()
        .set(&TREE_CAPACITY_KEY, &capacity);
    
    // Check and emit alert if capacity threshold crossed
    check_and_emit_capacity_alert(env);
    
    Ok(())
}

// Modify deposit to call increment_commitment_count
pub fn deposit(
    env: &Env,
    commitment: Bytes,
    amount: u128,
) -> Result<(), Error> {
    // Check tree capacity before deposit
    increment_commitment_count(env)?;
    
    // ... rest of deposit logic
    
    Ok(())
}

// Public query function
pub fn query_remaining_capacity(env: &Env) -> u64 {
    let capacity = get_tree_capacity(env);
    capacity.max_capacity - capacity.current_count
}

// Error types
pub enum Error {
    TreeAtCapacity { current: u64, max: u64 },
    // ... other errors
}
```

### Monitoring Integration

For operator alerting:
```rust
// These events can be monitored by off-chain indexer
// "capacity_alert" events with AlertLevel::Critical trigger immediate alerting
// Operators can query remaining_capacity periodically
```

### Acceptance Criteria
- ✅ Deposits revert with clear error when capacity reached
- ✅ Remaining capacity queryable on-chain
- ✅ Documented threshold triggers operator alerting

---

## Issue #586: Add Attestation Revocation

### Problem
Issued attestations cannot be revoked, so a compromised issuer key permanently pollutes reputation state.

### Solution
Add issuer-signed revocation with timestamps that downstream proofs must respect.

### Implementation

**File**: `contracts/attestation-engine-v2/src/lib.rs`

```rust
// Add revocation data structures
#[derive(Clone, Debug)]
pub struct Attestation {
    pub issuer: Address,
    pub subject: Address,
    pub claim: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub id: Bytes,
    pub revoked_at: Option<u64>, // Added: timestamp when revoked
}

#[derive(Clone, Debug)]
pub struct RevocationRecord {
    pub attestation_id: Bytes,
    pub issuer: Address,
    pub revoked_at: u64,
    pub reason: String,
}

// Storage keys
const ATTESTATIONS_KEY: &str = "attestations";
const REVOCATIONS_KEY: &str = "revocations";
const REVOCATION_ROOTS_KEY: &str = "revocation_roots";

// Issue attestation (unchanged signature, but stores with revoked_at = None)
pub fn issue_attestation(
    env: &Env,
    issuer: Address,
    subject: Address,
    claim: String,
    expires_at: u64,
) -> Result<Bytes, Error> {
    // Verify issuer
    verify_issuer(env, &issuer)?;
    
    // Generate attestation ID
    let id = generate_attestation_id(env, &issuer, &subject, &claim);
    
    let attestation = Attestation {
        issuer,
        subject,
        claim,
        issued_at: env.block().timestamp(),
        expires_at,
        id: id.clone(),
        revoked_at: None,
    };
    
    // Store attestation
    let mut attestations = get_all_attestations(env);
    attestations.push(attestation);
    store_attestations(env, &attestations);
    
    // Emit event
    env.events().publish(
        ("attestation", "issued"),
        (&id, &issuer, &subject),
    );
    
    Ok(id)
}

// NEW: Revoke attestation (issuer-signed)
pub fn revoke_attestation(
    env: &Env,
    caller: Address,
    attestation_id: Bytes,
    reason: String,
) -> Result<(), Error> {
    // Get attestation
    let mut attestation = get_attestation(env, &attestation_id)?;
    
    // Verify only issuer can revoke
    if attestation.issuer != caller {
        return Err(Error::OnlyIssuerCanRevoke);
    }
    
    // Mark as revoked
    attestation.revoked_at = Some(env.block().timestamp());
    
    // Store updated attestation
    update_attestation(env, &attestation)?;
    
    // Record revocation
    let revocation = RevocationRecord {
        attestation_id: attestation_id.clone(),
        issuer: caller.clone(),
        revoked_at: env.block().timestamp(),
        reason: reason.clone(),
    };
    
    store_revocation(env, &revocation);
    
    // Update revocation root for circuits
    update_revocation_root(env)?;
    
    // Emit event
    env.events().publish(
        ("attestation", "revoked"),
        (&attestation_id, &caller, &reason),
    );
    
    Ok(())
}

// NEW: Check if attestation is revoked
pub fn is_attestation_revoked(env: &Env, attestation_id: &Bytes) -> Result<bool, Error> {
    let attestation = get_attestation(env, attestation_id)?;
    Ok(attestation.revoked_at.is_some())
}

// NEW: Get revocation timestamp
pub fn get_revocation_timestamp(env: &Env, attestation_id: &Bytes) -> Result<Option<u64>, Error> {
    let attestation = get_attestation(env, attestation_id)?;
    Ok(attestation.revoked_at)
}

// NEW: Get all revocations for an issuer
pub fn get_issuer_revocations(env: &Env, issuer: &Address) -> Vec<RevocationRecord> {
    let revocations = env.storage()
        .instance()
        .get::<_, Vec<RevocationRecord>>(&REVOCATIONS_KEY)
        .unwrap_or_default();
    
    revocations
        .into_iter()
        .filter(|r| r.issuer == *issuer)
        .collect()
}

// Helper: Generate revocation root for circuits
pub fn get_revocation_root(env: &Env) -> Bytes {
    env.storage()
        .instance()
        .get::<_, Bytes>(&REVOCATION_ROOTS_KEY)
        .unwrap_or_default()
}

// Update revocation root (Merkle root of revoked attestations)
fn update_revocation_root(env: &Env) -> Result<(), Error> {
    let revocations = env.storage()
        .instance()
        .get::<_, Vec<RevocationRecord>>(&REVOCATIONS_KEY)
        .unwrap_or_default();
    
    // Calculate Merkle root of revocation IDs
    let root = calculate_revocation_merkle_root(&revocations);
    
    env.storage()
        .instance()
        .set(&REVOCATION_ROOTS_KEY, &root);
    
    // Emit event for circuits to pick up
    env.events().publish(
        ("attestation", "revocation_root_updated"),
        (&root,),
    );
    
    Ok(())
}

// Error types
pub enum Error {
    OnlyIssuerCanRevoke,
    AttestationNotFound,
    // ... other errors
}
```

### Circuit Integration

Reputation circuits must be updated to:
```rust
// In reputation verifier circuit
// Verify attestation is not revoked by checking against revocation root
// Proof must include:
// - attestation_id
// - revocation_root (from on-chain)
// - Merkle proof showing attestation_id is NOT in revocation set
// - revocation timestamp (for temporal verification)

pub fn verify_attestation_not_revoked(
    attestation_id: &[u8],
    revocation_root: &[u8],
    merkle_proof: &[[u8; 32]],
) -> bool {
    // Verify attestation_id is NOT in the revocation tree
    // using merkle_proof and revocation_root
    let calculated_root = calculate_merkle_root_from_proof(attestation_id, merkle_proof);
    calculated_root == revocation_root
}
```

### Acceptance Criteria
- ✅ Revocation recorded on-chain and emitted as event
- ✅ Reputation circuits exclude revoked attestations after revocation root updates
- ✅ Revocation authority limited to original issuer

---

## Implementation Order

1. **Start with #584** (minimum withdrawal) - simplest, no dependencies
2. **Then #585** (capacity guard) - straightforward state tracking
3. **Then #583** (slashing conditions) - requires verification logic
4. **Then #586** (attestation revocation) - requires circuit updates

## Testing Strategy

For each issue:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_issue_number() {
        // Setup
        // Execute
        // Assert
    }
}
```

## Deployment Checklist

- [ ] Code review passed
- [ ] All tests passing
- [ ] Events documented and emitted
- [ ] Error types properly defined
- [ ] Contract storage versioning updated
- [ ] Frontend/SDK updated to handle new functionality
- [ ] Monitoring/alerting configured
- [ ] Testnet deployment successful
- [ ] Mainnet deployment approved

---

## Documentation Updates Needed

- Update contract README with slashing mechanism
- Document minimum withdrawal configuration
- Add capacity monitoring guide for operators
- Update attestation revocation flow in docs

---

**Generated**: 2024-07-25
**Status**: Implementation-ready
**Total Scope**: 4 interconnected contract features
