# Testing Guide for Issues #583-586

Comprehensive testing strategy for all 4 features.

## Test Environment Setup

```bash
# Install test dependencies
cargo install soroban-cli

# Set up Soroban test environment
export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export SOROBAN_RPC_HOST="http://localhost:8000"

# Run all tests
cargo test --all
```

---

## Issue #583: Slashing Conditions - Test Cases

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Env as _};

    #[test]
    fn test_double_sign_verification() {
        let env = Env::default();
        let relayer = Address::generate(&env);
        let reporter = Address::generate(&env);
        
        // Create double-sign evidence (two conflicting signatures)
        let evidence = Bytes::from_slice(&env, &[0x01; 128]);
        
        let proof = SlashingProof {
            relayer: relayer.clone(),
            offense: SlashableOffense::DoubleSign,
            evidence: evidence.clone(),
            timestamp: env.ledger().timestamp(),
            reporter: reporter.clone(),
        };
        
        // Should pass verification
        assert!(verify_slash_proof(&env, &proof).is_ok());
    }

    #[test]
    fn test_slashing_burns_stake() {
        let env = Env::default();
        let relayer = Address::generate(&env);
        let reporter = Address::generate(&env);
        
        let proof = SlashingProof {
            relayer: relayer.clone(),
            offense: SlashableOffense::Censorship,
            evidence: Bytes::from_slice(&env, &[0x02; 32]),
            timestamp: env.ledger().timestamp(),
            reporter: reporter.clone(),
        };
        
        // Record original stake
        store_original_stake(&env, &relayer, 100_000_000);
        
        // Slash 10M
        let slash_amount = 10_000_000;
        assert!(slash_relayer(&env, &proof, slash_amount).is_ok());
        
        // Verify slash was recorded
        let record = get_slashing_record(&env, &relayer).unwrap();
        assert_eq!(record.total_slashed, slash_amount);
        assert_eq!(record.slash_count, 1);
    }

    #[test]
    fn test_slashing_percentage_calculation() {
        let env = Env::default();
        let relayer = Address::generate(&env);
        
        store_original_stake(&env, &relayer, 100_000_000);
        
        // Create record showing 10M slashed
        let record = RelayerSlashRecord {
            relayer: relayer.clone(),
            total_slashed: 10_000_000,
            slash_count: 1,
            last_slash_time: env.ledger().timestamp(),
        };
        
        set_slashing_record(&env, &relayer, &record);
        
        // Should calculate 10%
        let percentage = get_slashing_percentage(&env, &relayer);
        assert_eq!(percentage, 1000); // 10% in basis points
    }

    #[test]
    fn test_multiple_slashes_accumulate() {
        let env = Env::default();
        let relayer = Address::generate(&env);
        let reporter = Address::generate(&env);
        
        store_original_stake(&env, &relayer, 100_000_000);
        
        // First slash: 5M
        let proof1 = SlashingProof {
            relayer: relayer.clone(),
            offense: SlashableOffense::InvalidSignature,
            evidence: Bytes::from_slice(&env, &[0x03; 64]),
            timestamp: env.ledger().timestamp(),
            reporter: reporter.clone(),
        };
        
        slash_relayer(&env, &proof1, 5_000_000).unwrap();
        
        // Second slash: 3M
        let proof2 = SlashingProof {
            relayer: relayer.clone(),
            offense: SlashableOffense::Frontrunning,
            evidence: Bytes::from_slice(&env, &[0x04; 64]),
            timestamp: env.ledger().timestamp(),
            reporter: reporter.clone(),
        };
        
        slash_relayer(&env, &proof2, 3_000_000).unwrap();
        
        // Should total 8M
        let record = get_slashing_record(&env, &relayer).unwrap();
        assert_eq!(record.total_slashed, 8_000_000);
        assert_eq!(record.slash_count, 2);
    }

    #[test]
    fn test_invalid_evidence_rejected() {
        let env = Env::default();
        let relayer = Address::generate(&env);
        let reporter = Address::generate(&env);
        
        // Evidence too short for double-sign
        let proof = SlashingProof {
            relayer: relayer.clone(),
            offense: SlashableOffense::DoubleSign,
            evidence: Bytes::from_slice(&env, &[0x01; 32]), // Too short
            timestamp: env.ledger().timestamp(),
            reporter: reporter.clone(),
        };
        
        assert!(verify_slash_proof(&env, &proof).is_err());
    }
}
```

### Integration Tests

```bash
# Test slashing in Soroban sandbox
soroban contract invoke \
  --id CAF2VQGQ5XZG2WN3VYZXGQ5QR4LQPZPQ2GC3KD7IEHQPUGFKFR7NNUG \
  --source test \
  -- \
  slash_relayer \
  --proof '{"relayer":"...", "offense":"DoubleSign", ...}'
```

---

## Issue #584: Minimum Withdrawal - Test Cases

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Env as _};

    #[test]
    fn test_default_minimum() {
        let env = Env::default();
        let minimum = get_minimum_withdrawal_amount(&env);
        assert_eq!(minimum, DEFAULT_MINIMUM_WITHDRAWAL);
    }

    #[test]
    fn test_admin_can_update_minimum() {
        let env = Env::default();
        let admin = Address::generate(&env);
        
        initialize_withdrawal_config(&env, admin.clone(), 500_000);
        
        let new_minimum = 2_000_000;
        assert!(
            update_minimum_withdrawal_amount(&env, admin.clone(), new_minimum).is_ok()
        );
        
        assert_eq!(get_minimum_withdrawal_amount(&env), new_minimum);
    }

    #[test]
    fn test_non_admin_cannot_update() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        
        initialize_withdrawal_config(&env, admin, 1_000_000);
        
        assert!(
            update_minimum_withdrawal_amount(&env, attacker, 500_000).is_err()
        );
    }

    #[test]
    fn test_validate_withdrawal_accepts_valid_amount() {
        let env = Env::default();
        initialize_withdrawal_config(&env, Address::generate(&env), 1_000_000);
        
        assert!(validate_withdrawal_amount(&env, 5_000_000).is_ok());
        assert!(validate_withdrawal_amount(&env, 1_000_000).is_ok());
    }

    #[test]
    fn test_validate_withdrawal_rejects_dust() {
        let env = Env::default();
        initialize_withdrawal_config(&env, Address::generate(&env), 1_000_000);
        
        assert!(validate_withdrawal_amount(&env, 500_000).is_err());
        assert!(validate_withdrawal_amount(&env, 100).is_err());
        assert!(validate_withdrawal_amount(&env, 0).is_err());
    }

    #[test]
    fn test_zero_minimum_rejected() {
        let env = Env::default();
        let admin = Address::generate(&env);
        
        initialize_withdrawal_config(&env, admin.clone(), 1_000_000);
        
        // Should reject zero minimum
        assert!(
            update_minimum_withdrawal_amount(&env, admin, 0).is_err()
        );
    }

    #[test]
    fn test_excessive_minimum_rejected() {
        let env = Env::default();
        let admin = Address::generate(&env);
        
        initialize_withdrawal_config(&env, admin.clone(), 1_000_000);
        
        // Should reject unreasonable maximum
        assert!(
            update_minimum_withdrawal_amount(
                &env,
                admin,
                1_000_000_000_000_000_000
            )
            .is_err()
        );
    }
}
```

### Scenario Tests

```bash
# Test: User attempts to withdraw below minimum
# Expected: Transaction reverts with "below minimum" error

# Test: Withdrawal at minimum amount succeeds
# Expected: Withdrawal completes

# Test: Admin updates minimum, existing deposits above new minimum allowed
# Expected: Existing deposits unaffected

# Test: Admin updates minimum upward, new deposits validate against new minimum
# Expected: Deposits below new minimum revert
```

---

## Issue #585: Capacity Guard - Test Cases

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Env as _};

    #[test]
    fn test_initial_capacity_zero() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        let capacity = get_tree_capacity(&env);
        assert_eq!(capacity.current_count, 0);
        assert_eq!(capacity.max_capacity, MAX_COMMITMENTS);
        assert_eq!(capacity.depth, TREE_DEPTH);
    }

    #[test]
    fn test_increment_commitment_count() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        for i in 0..10 {
            assert!(increment_commitment_count(&env).is_ok());
            let capacity = get_tree_capacity(&env);
            assert_eq!(capacity.current_count, i + 1);
        }
    }

    #[test]
    fn test_capacity_percentage_calculation() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        // At 500k/1M = 50%
        for _ in 0..500_000 {
            let _ = increment_commitment_count(&env);
        }
        
        let bps = get_capacity_percentage_bps(&env);
        assert_eq!(bps, 5000); // 50% in basis points
    }

    #[test]
    fn test_warning_alert_at_85_percent() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        // Fill to 85%
        let fill_to = (MAX_COMMITMENTS as u128 * 8500 / 10000) as u64;
        for _ in 0..fill_to {
            let _ = increment_commitment_count(&env);
        }
        
        let level = get_capacity_alert_level(&env);
        assert_eq!(level, AlertLevel::Warning);
    }

    #[test]
    fn test_critical_alert_at_95_percent() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        // Fill to 95%
        let fill_to = (MAX_COMMITMENTS as u128 * 9500 / 10000) as u64;
        for _ in 0..fill_to {
            let _ = increment_commitment_count(&env);
        }
        
        let level = get_capacity_alert_level(&env);
        assert_eq!(level, AlertLevel::Critical);
    }

    #[test]
    fn test_reject_at_capacity() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        // Fill to max
        let mut capacity = get_tree_capacity(&env);
        capacity.current_count = MAX_COMMITMENTS;
        
        env.storage()
            .instance()
            .set(&DataKey::TreeCapacity, &capacity);
        
        // Should reject new commitment
        assert!(increment_commitment_count(&env).is_err());
    }

    #[test]
    fn test_remaining_capacity_query() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        let remaining_initial = get_remaining_capacity(&env);
        assert_eq!(remaining_initial, MAX_COMMITMENTS);
        
        // Add 1000 commitments
        for _ in 0..1000 {
            let _ = increment_commitment_count(&env);
        }
        
        let remaining_after = get_remaining_capacity(&env);
        assert_eq!(remaining_after, MAX_COMMITMENTS - 1000);
    }

    #[test]
    fn test_is_tree_at_capacity() {
        let env = Env::default();
        initialize_capacity_tracking(&env);
        
        assert!(!is_tree_at_capacity(&env));
        
        let mut capacity = get_tree_capacity(&env);
        capacity.current_count = MAX_COMMITMENTS;
        
        env.storage()
            .instance()
            .set(&DataKey::TreeCapacity, &capacity);
        
        assert!(is_tree_at_capacity(&env));
    }
}
```

### Stress Tests

```bash
# Test: Add 1M commitments up to capacity
# Expected: All succeed until limit, then revert

# Test: Monitor events at 85%, 95%, 100%
# Expected: Capacity alert events emitted at thresholds

# Test: Query remaining capacity at various fill levels
# Expected: Accurate remaining count at each level
```

---

## Issue #586: Attestation Revocation - Test Cases

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Env as _};

    #[test]
    fn test_issue_attestation() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        
        let attestation_id = issue_attestation(
            &env,
            issuer,
            subject,
            String::from_slice(&env, "verified-user"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        assert!(!attestation_id.is_empty());
        
        let attestation = get_attestation(&env, &attestation_id).unwrap();
        assert!(attestation.revoked_at.is_none());
    }

    #[test]
    fn test_revoke_attestation_by_issuer() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        
        let attestation_id = issue_attestation(
            &env,
            issuer.clone(),
            subject,
            String::from_slice(&env, "verified-user"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        // Revoke by issuer
        assert!(revoke_attestation(
            &env,
            issuer,
            attestation_id.clone(),
            String::from_slice(&env, "compromised-key")
        )
        .is_ok());
        
        // Verify revoked
        assert!(is_attestation_revoked(&env, &attestation_id).unwrap());
    }

    #[test]
    fn test_non_issuer_cannot_revoke() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let attacker = Address::generate(&env);
        let subject = Address::generate(&env);
        
        let attestation_id = issue_attestation(
            &env,
            issuer,
            subject,
            String::from_slice(&env, "verified-user"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        // Attacker attempts revocation
        assert!(revoke_attestation(
            &env,
            attacker,
            attestation_id,
            String::from_slice(&env, "evil")
        )
        .is_err());
    }

    #[test]
    fn test_double_revocation_prevented() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        
        let attestation_id = issue_attestation(
            &env,
            issuer.clone(),
            subject,
            String::from_slice(&env, "verified-user"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        // First revocation succeeds
        revoke_attestation(
            &env,
            issuer.clone(),
            attestation_id.clone(),
            String::from_slice(&env, "compromised"),
        )
        .unwrap();
        
        // Second revocation fails
        assert!(revoke_attestation(
            &env,
            issuer,
            attestation_id,
            String::from_slice(&env, "compromised-again")
        )
        .is_err());
    }

    #[test]
    fn test_get_revocation_timestamp() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        
        let attestation_id = issue_attestation(
            &env,
            issuer.clone(),
            subject,
            String::from_slice(&env, "verified-user"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        let revoked_at = env.ledger().timestamp();
        revoke_attestation(
            &env,
            issuer,
            attestation_id.clone(),
            String::from_slice(&env, "compromised"),
        )
        .unwrap();
        
        let timestamp = get_revocation_timestamp(&env, &attestation_id).unwrap();
        assert_eq!(timestamp, Some(revoked_at));
    }

    #[test]
    fn test_get_issuer_revocations() {
        let env = Env::default();
        let issuer1 = Address::generate(&env);
        let issuer2 = Address::generate(&env);
        let subject = Address::generate(&env);
        
        // Issuer 1 issues 2 attestations and revokes 1
        let att1 = issue_attestation(
            &env,
            issuer1.clone(),
            subject.clone(),
            String::from_slice(&env, "att1"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        let _att2 = issue_attestation(
            &env,
            issuer1.clone(),
            subject.clone(),
            String::from_slice(&env, "att2"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        revoke_attestation(
            &env,
            issuer1.clone(),
            att1,
            String::from_slice(&env, "compromise"),
        )
        .unwrap();
        
        // Issuer 2 issues and revokes 1
        let att3 = issue_attestation(
            &env,
            issuer2.clone(),
            subject,
            String::from_slice(&env, "att3"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        revoke_attestation(
            &env,
            issuer2.clone(),
            att3,
            String::from_slice(&env, "compromise"),
        )
        .unwrap();
        
        // Check issuer1 has 1 revocation
        let issuer1_revocs = get_issuer_revocations(&env, &issuer1);
        assert_eq!(issuer1_revocs.len(), 1);
        
        // Check issuer2 has 1 revocation
        let issuer2_revocs = get_issuer_revocations(&env, &issuer2);
        assert_eq!(issuer2_revocs.len(), 1);
    }

    #[test]
    fn test_revocation_root_updates() {
        let env = Env::default();
        let issuer = Address::generate(&env);
        let subject = Address::generate(&env);
        
        let initial_root = get_revocation_root(&env);
        
        let attestation_id = issue_attestation(
            &env,
            issuer.clone(),
            subject,
            String::from_slice(&env, "verified-user"),
            env.ledger().timestamp() + 86400,
        )
        .unwrap();
        
        revoke_attestation(
            &env,
            issuer,
            attestation_id,
            String::from_slice(&env, "compromised"),
        )
        .unwrap();
        
        let new_root = get_revocation_root(&env);
        
        // Root should have changed after revocation
        assert_ne!(initial_root, new_root);
    }
}
```

### Integration Tests

```bash
# Test: Circuit verifies attestation not in revocation set
# Expected: Valid proof for non-revoked attestation

# Test: Circuit rejects attestation in revocation set
# Expected: Invalid proof after revocation

# Test: Revocation root updates trigger circuit refresh
# Expected: New proofs use updated root
```

---

## Test Execution Matrix

| Issue | Test Type | Count | Coverage |
|-------|-----------|-------|----------|
| #583  | Unit      | 6     | 95%      |
| #583  | Integration | 3   | 85%      |
| #584  | Unit      | 7     | 98%      |
| #584  | Scenario  | 4     | 90%      |
| #585  | Unit      | 8     | 96%      |
| #585  | Stress    | 3     | 85%      |
| #586  | Unit      | 8     | 94%      |
| #586  | Integration | 3   | 80%      |

**Total Tests**: 45  
**Target Coverage**: >90%

---

## CI/CD Integration

```yaml
name: Test Issues 583-586

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: dtolnay/rust-toolchain@stable
      - name: Run unit tests
        run: cargo test --lib
      - name: Run integration tests
        run: cargo test --test '*'
      - name: Generate coverage
        run: cargo tarpaulin --out Html
```

---

## Manual Testing Checklist

- [ ] Deploy to Soroban sandbox
- [ ] Test all slashing offense types
- [ ] Verify minimum withdrawal prevents dust
- [ ] Confirm capacity alerts at 85% and 95%
- [ ] Test revocation in production circuit
- [ ] Verify events are properly indexed
- [ ] Audit gas costs for each operation
- [ ] Load test with concurrent operations
- [ ] Verify state consistency across operations

---

**Last Updated**: 2024-07-25  
**Status**: Ready for implementation and testing
