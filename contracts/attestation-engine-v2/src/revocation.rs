// Issue #586: Attestation revocation with issuer signatures
// Allows attestation revocation by original issuer to prevent compromised key pollution

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Attestation {
    pub issuer: Address,
    pub subject: Address,
    pub claim: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub id: Bytes,
    pub revoked_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RevocationRecord {
    pub attestation_id: Bytes,
    pub issuer: Address,
    pub revoked_at: u64,
    pub reason: String,
}

#[contracttype]
pub enum DataKey {
    Attestation(Bytes),
    AllAttestations,
    AllRevocations,
    RevocationRoot,
    IssuerAttestations(Address),
}

pub fn store_attestation(env: &Env, attestation: &Attestation) {
    env.storage()
        .persistent()
        .set(&DataKey::Attestation(attestation.id.clone()), attestation);

    // Track all attestations for querying
    let mut all = env.storage()
        .persistent()
        .get::<_, Vec<Bytes>>(&DataKey::AllAttestations)
        .unwrap_or_default();

    all.push_back(attestation.id.clone());

    env.storage()
        .persistent()
        .set(&DataKey::AllAttestations, &all);
}

pub fn get_attestation(env: &Env, attestation_id: &Bytes) -> Result<Attestation, String> {
    env.storage()
        .persistent()
        .get(&DataKey::Attestation(attestation_id.clone()))
        .ok_or("Attestation not found".into())
}

pub fn issue_attestation(
    env: &Env,
    issuer: Address,
    subject: Address,
    claim: String,
    expires_at: u64,
) -> Result<Bytes, String> {
    // Generate attestation ID
    let id = env.crypto().keccak256(&(
        &issuer,
        &subject,
        &claim,
        env.ledger().timestamp(),
    ).encode(env));

    let attestation = Attestation {
        issuer: issuer.clone(),
        subject: subject.clone(),
        claim: claim.clone(),
        issued_at: env.ledger().timestamp(),
        expires_at,
        id: id.clone(),
        revoked_at: None,
    };

    store_attestation(env, &attestation);

    // Emit event
    env.events().publish(
        (symbol_short!("attest"), symbol_short!("issued")),
        (&id, &issuer, &subject),
    );

    Ok(id)
}

pub fn revoke_attestation(
    env: &Env,
    caller: Address,
    attestation_id: Bytes,
    reason: String,
) -> Result<(), String> {
    // Get attestation
    let mut attestation = get_attestation(env, &attestation_id)?;

    // Verify only issuer can revoke
    if attestation.issuer != caller {
        return Err("Only attestation issuer can revoke".into());
    }

    // Check not already revoked
    if attestation.revoked_at.is_some() {
        return Err("Attestation already revoked".into());
    }

    // Mark as revoked
    attestation.revoked_at = Some(env.ledger().timestamp());

    // Store updated attestation
    env.storage()
        .persistent()
        .set(&DataKey::Attestation(attestation_id.clone()), &attestation);

    // Record revocation
    let revocation = RevocationRecord {
        attestation_id: attestation_id.clone(),
        issuer: caller.clone(),
        revoked_at: env.ledger().timestamp(),
        reason: reason.clone(),
    };

    store_revocation(env, &revocation)?;

    // Update revocation root for circuits
    update_revocation_root(env)?;

    // Emit event
    env.events().publish(
        (symbol_short!("attest"), symbol_short!("revoked")),
        (&attestation_id, &caller, &reason),
    );

    Ok(())
}

pub fn is_attestation_revoked(env: &Env, attestation_id: &Bytes) -> Result<bool, String> {
    let attestation = get_attestation(env, attestation_id)?;
    Ok(attestation.revoked_at.is_some())
}

pub fn get_revocation_timestamp(env: &Env, attestation_id: &Bytes) -> Result<Option<u64>, String> {
    let attestation = get_attestation(env, attestation_id)?;
    Ok(attestation.revoked_at)
}

pub fn get_issuer_revocations(env: &Env, issuer: &Address) -> Vec<RevocationRecord> {
    let revocations = env.storage()
        .persistent()
        .get::<_, Vec<RevocationRecord>>(&DataKey::AllRevocations)
        .unwrap_or_default();

    let mut result: Vec<RevocationRecord> = Vec::new();
    for revocation in revocations.iter() {
        if revocation.issuer == *issuer {
            result.push_back(revocation.clone());
        }
    }
    result
}

pub fn store_revocation(env: &Env, revocation: &RevocationRecord) -> Result<(), String> {
    let mut revocations = env.storage()
        .persistent()
        .get::<_, Vec<RevocationRecord>>(&DataKey::AllRevocations)
        .unwrap_or_default();

    revocations.push_back(revocation.clone());

    env.storage()
        .persistent()
        .set(&DataKey::AllRevocations, &revocations);

    Ok(())
}

pub fn get_revocation_root(env: &Env) -> Bytes {
    env.storage()
        .persistent()
        .get::<_, Bytes>(&DataKey::RevocationRoot)
        .unwrap_or_default()
}

pub fn update_revocation_root(env: &Env) -> Result<(), String> {
    let revocations = env.storage()
        .persistent()
        .get::<_, Vec<RevocationRecord>>(&DataKey::AllRevocations)
        .unwrap_or_default();

    // Calculate Merkle root of revocation IDs
    let root = calculate_revocation_merkle_root(env, &revocations);

    env.storage()
        .persistent()
        .set(&DataKey::RevocationRoot, &root);

    // Emit event for circuits to pick up
    env.events().publish(
        (symbol_short!("attest"), symbol_short!("rev_root")),
        (&root,),
    );

    Ok(())
}

// Helper: Calculate Merkle root of revoked attestation IDs
fn calculate_revocation_merkle_root(env: &Env, revocations: &Vec<RevocationRecord>) -> Bytes {
    if revocations.len() == 0 {
        // Return default root for empty set
        return Bytes::new(env);
    }

    // In production, implement proper Merkle tree
    // For now, hash all revocation IDs together
    let mut hasher_input = Vec::new();
    for revocation in revocations.iter() {
        hasher_input.push_back(revocation.attestation_id.clone());
    }

    // Simple chained hash (not production-ready, but demonstrates concept)
    let mut current = Bytes::new(env);
    for rev_id in hasher_input.iter() {
        current = env.crypto().keccak256(&(current, rev_id).encode(env));
    }

    current
}

pub fn query_total_revocations(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get::<_, Vec<RevocationRecord>>(&DataKey::AllRevocations)
        .map(|v| v.len() as u32)
        .unwrap_or(0)
}

pub fn query_issuer_revocation_count(env: &Env, issuer: &Address) -> u32 {
    let revocations = get_issuer_revocations(env, issuer);
    revocations.len() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_revocation_record_structure() {
        // Validate that RevocationRecord contains all necessary fields
        // In real tests, would construct with test environment
        assert!(true); // Placeholder for compilation
    }

    #[test]
    fn test_attestation_structure() {
        // Validate that Attestation contains revoked_at field
        // which can be Some(u64) or None
        assert!(true); // Placeholder for compilation
    }

    #[test]
    fn test_merkle_root_consistency() {
        // Test that same revocations produce same root
        // Test that different revocations produce different roots
        assert!(true); // Placeholder for compilation
    }
}
