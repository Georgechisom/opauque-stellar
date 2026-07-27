// Issue #583: Slashing conditions for relayer stake
// This module implements evidence-based slashing for relayer misbehavior

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env, String, Symbol,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SlashableOffense {
    DoubleSign = 0,      // Signing conflicting transactions
    Censorship = 1,      // Selectively censoring transactions
    DelayedInclusion = 2, // Delaying transaction inclusion
    InvalidSignature = 3, // Providing invalid signature
    Frontrunning = 4,     // Frontrunning user transactions
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SlashingProof {
    pub relayer: Address,
    pub offense: SlashableOffense,
    pub evidence: Bytes,
    pub timestamp: u64,
    pub reporter: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RelayerSlashRecord {
    pub relayer: Address,
    pub total_slashed: u128,
    pub slash_count: u32,
    pub last_slash_time: u64,
}

#[contracttype]
pub enum DataKey {
    SlashRecord(Address),
    OriginalStake(Address),
}

pub fn get_slashing_record(env: &Env, relayer: &Address) -> Option<RelayerSlashRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::SlashRecord(relayer.clone()))
}

pub fn set_slashing_record(env: &Env, relayer: &Address, record: &RelayerSlashRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::SlashRecord(relayer.clone()), record);
}

pub fn store_original_stake(env: &Env, relayer: &Address, stake: u128) {
    env.storage()
        .persistent()
        .set(&DataKey::OriginalStake(relayer.clone()), &stake);
}

pub fn get_original_stake(env: &Env, relayer: &Address) -> Option<u128> {
    env.storage()
        .persistent()
        .get(&DataKey::OriginalStake(relayer.clone()))
}

// Verify slash proof based on offense type
pub fn verify_slash_proof(env: &Env, proof: &SlashingProof) -> Result<(), String> {
    match proof.offense {
        SlashableOffense::DoubleSign => verify_double_sign_evidence(&proof.evidence),
        SlashableOffense::Censorship => verify_censorship_evidence(env, &proof.evidence),
        SlashableOffense::DelayedInclusion => verify_delayed_inclusion_evidence(env, &proof.evidence),
        SlashableOffense::InvalidSignature => verify_invalid_signature_evidence(&proof.evidence),
        SlashableOffense::Frontrunning => verify_frontrunning_evidence(env, &proof.evidence),
    }
}

fn verify_double_sign_evidence(_evidence: &Bytes) -> Result<(), String> {
    // Placeholder: In production, verify two conflicting signatures exist
    // This would typically involve checking:
    // - Same transaction hash but different signatures
    // - Both signatures are valid for the relayer
    // - Signatures are cryptographically different
    if _evidence.len() < 64 {
        return Err("Invalid double-sign evidence format".into());
    }
    Ok(())
}

fn verify_censorship_evidence(_env: &Env, _evidence: &Bytes) -> Result<(), String> {
    // Placeholder: Verify transaction was submitted but not included
    // Would check:
    // - Transaction was in mempool
    // - Not included within N blocks
    // - No conflicting transaction included
    if _evidence.len() < 32 {
        return Err("Invalid censorship evidence format".into());
    }
    Ok(())
}

fn verify_delayed_inclusion_evidence(_env: &Env, _evidence: &Bytes) -> Result<(), String> {
    // Placeholder: Verify inclusion was delayed beyond threshold
    // Would check:
    // - Transaction submitted at time T
    // - Included at time T+N where N exceeds acceptable delay
    if _evidence.len() < 32 {
        return Err("Invalid delayed-inclusion evidence format".into());
    }
    Ok(())
}

fn verify_invalid_signature_evidence(_evidence: &Bytes) -> Result<(), String> {
    // Placeholder: Verify signature is invalid
    // Would check:
    // - Signature fails recovery
    // - Signature doesn't match message hash
    if _evidence.len() < 64 {
        return Err("Invalid signature evidence format".into());
    }
    Ok(())
}

fn verify_frontrunning_evidence(_env: &Env, _evidence: &Bytes) -> Result<(), String> {
    // Placeholder: Verify frontrunning occurred
    // Would check:
    // - User transaction mempool entry timestamp
    // - Relayer's transaction timestamp
    // - Both target same application/state
    if _evidence.len() < 64 {
        return Err("Invalid frontrunning evidence format".into());
    }
    Ok(())
}

pub fn slash_relayer(
    env: &Env,
    proof: &SlashingProof,
    slash_amount: u128,
) -> Result<(), String> {
    // Verify proof validity
    verify_slash_proof(env, proof)?;

    // In production, verify relayer has sufficient stake
    // For now, we'll just track the slash
    if slash_amount == 0 {
        return Err("Slash amount must be positive".into());
    }

    // Get or create record
    let mut record = get_slashing_record(env, &proof.relayer)
        .unwrap_or(RelayerSlashRecord {
            relayer: proof.relayer.clone(),
            total_slashed: 0,
            slash_count: 0,
            last_slash_time: 0,
        });

    record.total_slashed = record.total_slashed.saturating_add(slash_amount);
    record.slash_count = record.slash_count.saturating_add(1);
    record.last_slash_time = env.ledger().timestamp();

    set_slashing_record(env, &proof.relayer, &record);

    // Emit event
    env.events().publish(
        (symbol_short!("relayer"), symbol_short!("slashed")),
        (&proof.relayer, proof.offense.clone(), slash_amount, &proof.reporter),
    );

    Ok(())
}

pub fn get_slashing_percentage(env: &Env, relayer: &Address) -> u64 {
    if let Some(record) = get_slashing_record(env, relayer) {
        if let Some(original_stake) = get_original_stake(env, relayer) {
            if original_stake == 0 {
                return 0;
            }
            return ((record.total_slashed as u128 * 10000) / original_stake as u128) as u64;
        }
    }
    0
}

pub fn get_relayer_slash_count(env: &Env, relayer: &Address) -> u32 {
    get_slashing_record(env, relayer).map(|r| r.slash_count).unwrap_or(0)
}

pub fn get_relayer_total_slashed(env: &Env, relayer: &Address) -> u128 {
    get_slashing_record(env, relayer)
        .map(|r| r.total_slashed)
        .unwrap_or(0)
}
