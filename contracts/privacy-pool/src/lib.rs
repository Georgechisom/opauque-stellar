#![no_std]
// Retain the classic events().publish API so the off-chain ASP/state-root indexers
// and the frontend keep a stable on-chain event ABI.
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

//! # privacy-pool
//!
//! An association-set privacy pool for native XLM (Opaque Cash, Phase 5). Mirrors the
//! `opaquecash/spec` privacy-pool: commitment-based deposits, zero-knowledge partial
//! withdrawals proven against the pool **state tree** and an **ASP association tree**.
//!
//! ## Why the state tree is maintained off-chain
//!
//! The spec's preferred design inserts each commitment into an on-chain Poseidon Merkle
//! tree. We measured that (see `contracts/opaque-poseidon` + `contracts/poseidon-bench`):
//! a single Poseidon hash costs ~40M CPU instructions, so even one insertion blows
//! Stellar's 100M-per-tx budget. On-chain insertion is therefore infeasible at any depth.
//!
//! This contract implements the plan's documented fallback: the **state root is published
//! off-chain** (by an indexer reading `Deposit` events), exactly like the ASP root, and an
//! on-chain **custody invariant** caps aggregate withdrawals at aggregate deposits so a bad
//! root can never mint unbacked funds. The trusted-publisher trade-off is documented; the
//! SAC balance is the physical backstop. The `context` binding uses the cheap host
//! keccak256, not Poseidon — so this contract does no Poseidon at all.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env,
    IntoVal, Symbol, Vec, U256,
};

/// Default root validity window (~1 day at 5 s/ledger). Overridable via set_root_expiry.
const DEFAULT_ROOT_EXPIRY_LEDGERS: u32 = 17_280;
const MAX_ROOT_HISTORY: u32 = 100;
const EVENT_VERSION: u32 = 1;

/// BN254 scalar field order r, big-endian — `context` is reduced modulo this so it is a
/// valid circuit public input.
const SCALAR_FIELD: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[contract]
pub struct PrivacyPool;

#[contracttype]
#[derive(Clone)]
pub struct PoolConfig {
    pub admin: Address,
    pub groth16_verifier: Address,
    pub native_sac: Address,
    pub scope: u64,
    pub root_expiry_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct RootEntry {
    pub ledger: u32,
    pub dataset_hash: BytesN<32>,
}

/// Mirror of groth16-verifier's `VerifyPublicInputsV3`. Field names/types/order must match
/// exactly so the cross-contract call serializes to the expected ScMap, and the order must
/// match circuits/v3/privacy_pool_withdraw.circom's public-signal vector.
#[contracttype]
#[derive(Clone)]
pub struct VerifyPublicInputsV3 {
    pub withdrawn_value: BytesN<32>,
    pub state_root: BytesN<32>,
    pub asp_root: BytesN<32>,
    pub nullifier_hash: BytesN<32>,
    pub new_commitment: BytesN<32>,
    pub context: BytesN<32>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    Unauthorized = 1,
    AlreadyInitialized = 2,
    InvalidProof = 3,
    NullifierUsed = 4,
    UnknownStateRoot = 5,
    UnknownAspRoot = 6,
    RootExpired = 7,
    BadAmount = 8,
    IndexMismatch = 9,
    CustodyViolation = 10,
}

// Which root namespace an entry belongs to.
const STATE: bool = true;
const ASP: bool = false;

fn cfg(env: &Env) -> PoolConfig {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "config"))
        .expect("config")
}

fn root_entry_key(env: &Env, kind: bool, root: &BytesN<32>) -> (Symbol, BytesN<32>) {
    let tag = if kind == STATE { "state_root" } else { "asp_root" };
    (Symbol::new(env, tag), root.clone())
}

fn history_key(env: &Env, kind: bool) -> Symbol {
    Symbol::new(env, if kind == STATE { "state_hist" } else { "asp_hist" })
}

fn nullifier_key(env: &Env, n: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(env, "nullifier"), n.clone())
}

fn commitment_key(env: &Env, c: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(env, "commit"), c.clone())
}

#[contractimpl]
impl PrivacyPool {
    pub fn initialize(
        env: Env,
        admin: Address,
        groth16_verifier: Address,
        native_sac: Address,
        scope: u64,
    ) -> Result<(), PoolError> {
        admin.require_auth();
        if env.storage().instance().has(&Symbol::new(&env, "config")) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(
            &Symbol::new(&env, "config"),
            &PoolConfig {
                admin,
                groth16_verifier,
                native_sac,
                scope,
                root_expiry_ledgers: DEFAULT_ROOT_EXPIRY_LEDGERS,
            },
        );
        env.storage()
            .instance()
            .set(&history_key(&env, STATE), &Vec::<BytesN<32>>::new(&env));
        env.storage()
            .instance()
            .set(&history_key(&env, ASP), &Vec::<BytesN<32>>::new(&env));
        env.storage().instance().set(&Symbol::new(&env, "dep_count"), &0u64);
        env.storage().instance().set(&Symbol::new(&env, "tot_dep"), &0i128);
        env.storage().instance().set(&Symbol::new(&env, "tot_wd"), &0i128);
        Ok(())
    }

    /// Read-only config accessor (deploy tooling reads this back to confirm wiring).
    pub fn get_config(env: Env) -> PoolConfig {
        cfg(&env)
    }

    /// Deposit `value` XLM under a client-computed `commitment`.
    ///
    /// `commitment = Poseidon(value, label, precommitment)` with `label = Poseidon(scope,
    /// expected_index)` is computed off-chain; the contract pulls the funds via the SAC,
    /// records the commitment + index, and emits `Deposit` for the indexer/ASP. `expected_index`
    /// must equal the current deposit count (binds the label to the right leaf index without
    /// hashing on-chain); a racing depositor simply retries with the new index.
    pub fn deposit(
        env: Env,
        depositor: Address,
        value: i128,
        commitment: BytesN<32>,
        expected_index: u64,
    ) -> Result<u64, PoolError> {
        depositor.require_auth();
        if value <= 0 {
            return Err(PoolError::BadAmount);
        }
        let config = cfg(&env);
        let index: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "dep_count"))
            .unwrap_or(0);
        if index != expected_index {
            return Err(PoolError::IndexMismatch);
        }

        // Pull funds into the pool's own SAC balance.
        let pool = env.current_contract_address();
        token::TokenClient::new(&env, &config.native_sac).transfer(&depositor, &pool, &value);

        // Record the commitment as legitimately deposited and bump counters.
        env.storage()
            .persistent()
            .set(&commitment_key(&env, &commitment), &index);
        env.storage().instance().set(&Symbol::new(&env, "dep_count"), &(index + 1));
        let total: i128 = env.storage().instance().get(&Symbol::new(&env, "tot_dep")).unwrap_or(0);
        env.storage().instance().set(&Symbol::new(&env, "tot_dep"), &(total + value));

        env.events().publish(
            (Symbol::new(&env, "Deposit"), EVENT_VERSION),
            (commitment.clone(), index, value, config.scope),
        );
        Ok(index)
    }

    /// Publish the off-chain-built commitment **state** tree root (admin only).
    pub fn update_state_root(
        env: Env,
        admin: Address,
        root: BytesN<32>,
        dataset_hash: BytesN<32>,
    ) -> Result<(), PoolError> {
        Self::publish_root(env, admin, root, dataset_hash, STATE)
    }

    /// Publish the ASP **association** tree root (admin only).
    pub fn update_asp_root(
        env: Env,
        admin: Address,
        root: BytesN<32>,
        dataset_hash: BytesN<32>,
    ) -> Result<(), PoolError> {
        Self::publish_root(env, admin, root, dataset_hash, ASP)
    }

    fn publish_root(
        env: Env,
        admin: Address,
        root: BytesN<32>,
        dataset_hash: BytesN<32>,
        kind: bool,
    ) -> Result<(), PoolError> {
        admin.require_auth();
        let config = cfg(&env);
        if config.admin != admin {
            return Err(PoolError::Unauthorized);
        }
        let ledger = env.ledger().sequence();
        env.storage().persistent().set(
            &root_entry_key(&env, kind, &root),
            &RootEntry { ledger, dataset_hash: dataset_hash.clone() },
        );
        let mut hist: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&history_key(&env, kind))
            .unwrap_or(Vec::new(&env));
        if hist.len() >= MAX_ROOT_HISTORY {
            hist.remove(0);
        }
        hist.push_back(root.clone());
        env.storage().instance().set(&history_key(&env, kind), &hist);

        let topic = if kind == STATE { "StateRootPublished" } else { "AspRootPublished" };
        env.events()
            .publish((Symbol::new(&env, topic), EVENT_VERSION), (root, ledger, dataset_hash));
        Ok(())
    }

    pub fn set_root_expiry(env: Env, admin: Address, expiry_ledgers: u32) -> Result<(), PoolError> {
        admin.require_auth();
        let mut config = cfg(&env);
        if config.admin != admin {
            return Err(PoolError::Unauthorized);
        }
        config.root_expiry_ledgers = expiry_ledgers;
        env.storage().instance().set(&Symbol::new(&env, "config"), &config);
        Ok(())
    }

    /// Withdraw `withdrawn_value` XLM from the pool to `recipient` (minus `fee` to `relayer`),
    /// proving in zero knowledge that an unspent deposit (clean per the ASP) backs it.
    pub fn withdraw(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        withdrawn_value: i128,
        state_root: BytesN<32>,
        asp_root: BytesN<32>,
        nullifier_hash: BytesN<32>,
        new_commitment: BytesN<32>,
        recipient: Address,
        fee: i128,
        relayer: Address,
    ) -> Result<(), PoolError> {
        let config = cfg(&env);
        if withdrawn_value <= 0 || fee < 0 || fee > withdrawn_value {
            return Err(PoolError::BadAmount);
        }

        // Roots must be known and unexpired.
        Self::require_fresh_root(&env, &config, STATE, &state_root, PoolError::UnknownStateRoot)?;
        Self::require_fresh_root(&env, &config, ASP, &asp_root, PoolError::UnknownAspRoot)?;

        // Nullifier replay protection.
        if env.storage().persistent().has(&nullifier_key(&env, &nullifier_hash)) {
            return Err(PoolError::NullifierUsed);
        }

        // Recompute the bound context — a relayer cannot redirect funds or alter the fee.
        let context = compute_context(&env, &recipient, withdrawn_value, fee, &relayer, config.scope);

        let public_inputs = VerifyPublicInputsV3 {
            withdrawn_value: BytesN::from_array(&env, &i128_be32(withdrawn_value)),
            state_root: state_root.clone(),
            asp_root: asp_root.clone(),
            nullifier_hash: nullifier_hash.clone(),
            new_commitment: new_commitment.clone(),
            context,
        };
        let valid: bool = env.invoke_contract(
            &config.groth16_verifier,
            &Symbol::new(&env, "verify_proof_v3"),
            (proof_a, proof_b, proof_c, public_inputs).into_val(&env),
        );
        if !valid {
            return Err(PoolError::InvalidProof);
        }

        // Custody invariant: aggregate withdrawals can never exceed aggregate deposits.
        let tot_dep: i128 = env.storage().instance().get(&Symbol::new(&env, "tot_dep")).unwrap_or(0);
        let tot_wd: i128 = env.storage().instance().get(&Symbol::new(&env, "tot_wd")).unwrap_or(0);
        if tot_wd + withdrawn_value > tot_dep {
            return Err(PoolError::CustodyViolation);
        }
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "tot_wd"), &(tot_wd + withdrawn_value));

        // Spend the nullifier and re-insert the remainder commitment as a new leaf.
        env.storage()
            .persistent()
            .set(&nullifier_key(&env, &nullifier_hash), &true);
        let index: u64 = env.storage().instance().get(&Symbol::new(&env, "dep_count")).unwrap_or(0);
        env.storage().persistent().set(&commitment_key(&env, &new_commitment), &index);
        env.storage().instance().set(&Symbol::new(&env, "dep_count"), &(index + 1));

        // Pay out from the pool's own SAC balance.
        let pool = env.current_contract_address();
        let token = token::TokenClient::new(&env, &config.native_sac);
        let payout = withdrawn_value - fee;
        if payout > 0 {
            token.transfer(&pool, &recipient, &payout);
        }
        if fee > 0 {
            token.transfer(&pool, &relayer, &fee);
        }

        env.events().publish(
            (Symbol::new(&env, "Withdraw"), EVENT_VERSION),
            (nullifier_hash, new_commitment, index, withdrawn_value),
        );
        Ok(())
    }

    fn require_fresh_root(
        env: &Env,
        config: &PoolConfig,
        kind: bool,
        root: &BytesN<32>,
        unknown: PoolError,
    ) -> Result<(), PoolError> {
        let entry: RootEntry = env
            .storage()
            .persistent()
            .get(&root_entry_key(env, kind, root))
            .ok_or(unknown)?;
        let now = env.ledger().sequence();
        if now.saturating_sub(entry.ledger) > config.root_expiry_ledgers {
            return Err(PoolError::RootExpired);
        }
        Ok(())
    }

    // ── Views ────────────────────────────────────────────────────────────────
    pub fn get_deposit_count(env: Env) -> u64 {
        env.storage().instance().get(&Symbol::new(&env, "dep_count")).unwrap_or(0)
    }

    pub fn is_known_state_root(env: Env, root: BytesN<32>) -> bool {
        env.storage().persistent().has(&root_entry_key(&env, STATE, &root))
    }

    pub fn is_known_asp_root(env: Env, root: BytesN<32>) -> bool {
        env.storage().persistent().has(&root_entry_key(&env, ASP, &root))
    }

    pub fn is_spent(env: Env, nullifier_hash: BytesN<32>) -> bool {
        env.storage().persistent().has(&nullifier_key(&env, &nullifier_hash))
    }

    pub fn get_latest_root(env: Env, state: bool) -> Result<BytesN<32>, PoolError> {
        let hist: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&history_key(&env, state))
            .unwrap_or(Vec::new(&env));
        if hist.is_empty() {
            return Err(if state { PoolError::UnknownStateRoot } else { PoolError::UnknownAspRoot });
        }
        Ok(hist.get(hist.len() - 1).unwrap())
    }

    /// (total_deposited, total_withdrawn) — the custody counters.
    pub fn get_custody(env: Env) -> (i128, i128) {
        (
            env.storage().instance().get(&Symbol::new(&env, "tot_dep")).unwrap_or(0),
            env.storage().instance().get(&Symbol::new(&env, "tot_wd")).unwrap_or(0),
        )
    }
}

/// i128 (>= 0) -> 32-byte big-endian field element.
fn i128_be32(v: i128) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[16..32].copy_from_slice(&v.to_be_bytes());
    out
}

/// context = keccak256(recipient_xdr ∥ withdrawn_value(16, BE) ∥ fee(16, BE) ∥ relayer_xdr ∥
/// scope(8, BE)) mod r. Binds the payout target and fee split into the proof so a relayer
/// cannot redirect funds. The frontend/prover replicates this exact preimage.
fn compute_context(
    env: &Env,
    recipient: &Address,
    withdrawn_value: i128,
    fee: i128,
    relayer: &Address,
    scope: u64,
) -> BytesN<32> {
    use soroban_sdk::xdr::ToXdr;
    let mut buf = recipient.clone().to_xdr(env);
    buf.append(&Bytes::from_array(env, &withdrawn_value.to_be_bytes()));
    buf.append(&Bytes::from_array(env, &fee.to_be_bytes()));
    buf.append(&relayer.clone().to_xdr(env));
    buf.append(&Bytes::from_array(env, &scope.to_be_bytes()));

    let digest: BytesN<32> = env.crypto().keccak256(&buf).into();
    // Reduce the 256-bit digest mod r so it is a valid BN254 scalar / circuit input.
    let v = U256::from_be_bytes(env, &Bytes::from_array(env, &digest.to_array()));
    let modulus = U256::from_be_bytes(env, &Bytes::from_array(env, &SCALAR_FIELD));
    let reduced = v.rem_euclid(&modulus);
    bytes_to_bytesn32(env, &reduced.to_be_bytes())
}

/// Right-align a (≤32-byte) Bytes into a 32-byte BytesN.
fn bytes_to_bytesn32(env: &Env, b: &Bytes) -> BytesN<32> {
    let len = b.len();
    let mut out = [0u8; 32];
    for i in 0..len {
        out[(32 - len + i) as usize] = b.get(i).unwrap();
    }
    BytesN::from_array(env, &out)
}

#[cfg(test)]
mod test;
