#![no_std]
#![allow(clippy::too_many_arguments)]
// Retain the classic events().publish API so off-chain indexers watching for
// signer-rotation and proposal events keep a stable on-chain event ABI,
// matching the convention in attestation-engine-v2 and privacy-pool.
#![allow(deprecated)]

//! # multisig-admin
//!
//! An on-chain N-of-M threshold admin contract (Issue #589). Registry contracts
//! (`attestation-engine-v2`, `privacy-pool`, `reputation-verifier`,
//! `relayer-registry`) point their `admin` (and, where applicable, `governance`)
//! field at a deployed instance of this contract instead of a single Stellar
//! account. Their existing `admin.require_auth()` checks need no code changes:
//! Soroban's authorization model already accepts a contract address as a valid
//! principal, and it is satisfied automatically for a contract's own *direct*
//! calls — exactly what this contract's `invoke_contract` call in `execute_call`
//! below is.
//!
//! ## Why a contract instead of a native Stellar multisig account
//!
//! Stellar accounts already support N-of-M signing natively (`SetOptions`), and
//! pointing a registry's `admin` at such an account would work with zero new
//! code. But the threshold in that model lives entirely off-chain in the
//! account's signer configuration — nothing on-chain can verify or document it.
//! This contract makes the threshold and signer set first-class, queryable
//! contract state (`get_config`), so "admin operations require the documented
//! signature threshold" is something a caller (or an auditor) can check
//! on-chain, not something they have to trust an operator configured correctly.
//!
//! ## Flow
//!
//! 1. `propose_call(proposer, target, fn_name, args)` or
//!    `propose_rotation(proposer, new_signers, new_threshold)` — a signer
//!    proposes an action. The proposer's approval is recorded immediately,
//!    executing right away if the threshold is 1 (not permitted below N=2
//!    signers / threshold 2, see `validate_signers_and_threshold`).
//! 2. `approve(signer, proposal_id)` — each other signer approves. Once
//!    distinct approvals reach the configured threshold, the action executes
//!    automatically in the same call.
//!
//! Signer rotation goes through the exact same propose/approve/threshold path
//! as any other action, so "key rotation within the set is supported without
//! redeployment" holds by construction — it is just another proposal kind.
//!
//! ## Why `propose_call`/`propose_rotation` instead of one generic `propose`
//!
//! An earlier version of this contract took a single `ProposalAction` enum
//! (a `Call { target, fn_name, args: Vec<Val> }` / `RotateSigners { .. }`
//! variant) as the `propose` parameter. `Val` — Soroban's type-erased "any"
//! value — cannot be embedded as a field inside another `#[contracttype]`;
//! the derive macro cannot produce a `Val -> ProposalAction` conversion. Two
//! plain entry points, each with concretely-typed parameters, avoid the
//! problem entirely and are no less general: the call's `args: Vec<Val>` is
//! still fully generic, it is just a bare, top-level parameter/storage value
//! instead of a field nested inside a custom enum.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol, Val, Vec,
};

#[contract]
pub struct MultisigAdmin;

/// TTL extension applied to every persistent proposal entry, matching the
/// convention used by the registries this contract administers (~120 days).
const PERSISTENT_TTL_LEDGERS: u32 = 2_073_600;

/// Hard cap on signer-set size, bounding the O(n^2) duplicate check in
/// `validate_signers_and_threshold` and the storage/CPU cost of iterating
/// approvals.
const MAX_SIGNERS: u32 = 20;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MultisigConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
}

/// A pending or executed admin action. `is_rotation` selects which of the two
/// mutually-exclusive field groups is populated: `target`/`fn_name` (args are
/// stored separately, see module docs) for a `Call`, or
/// `new_signers`/`new_threshold` for a `RotateSigners`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposal {
    pub id: BytesN<32>,
    pub is_rotation: bool,
    pub target: Address,
    pub fn_name: Symbol,
    pub new_signers: Vec<Address>,
    pub new_threshold: u32,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub executed: bool,
    pub created_at: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MultisigError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InsufficientSigners = 3,
    TooManySigners = 4,
    DuplicateSigner = 5,
    InvalidThreshold = 6,
    NotASigner = 7,
    ProposalNotFound = 8,
    AlreadyApproved = 9,
    AlreadyExecuted = 10,
}

fn config_key(env: &Env) -> Symbol {
    Symbol::new(env, "config")
}

fn next_id_key(env: &Env) -> Symbol {
    Symbol::new(env, "next_id")
}

fn proposal_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(id.env(), "proposal"), id.clone())
}

/// Separate storage slot for a Call proposal's arguments. Kept out of
/// `Proposal` itself because `Vec<Val>` cannot be a field of a derived
/// `#[contracttype]` — see the module-level doc comment.
fn args_key(id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(id.env(), "args"), id.clone())
}

fn load_config(env: &Env) -> Result<MultisigConfig, MultisigError> {
    env.storage()
        .instance()
        .get(&config_key(env))
        .ok_or(MultisigError::NotInitialized)
}

/// A threshold scheme with only one signer, or a threshold of 1, is a
/// single-key admin path wearing a multisig costume — it would satisfy none
/// of this issue's acceptance criteria. Require at least two distinct
/// signers and a threshold of at least two.
fn validate_signers_and_threshold(
    signers: &Vec<Address>,
    threshold: u32,
) -> Result<(), MultisigError> {
    if signers.len() < 2 {
        return Err(MultisigError::InsufficientSigners);
    }
    if signers.len() > MAX_SIGNERS {
        return Err(MultisigError::TooManySigners);
    }
    for i in 0..signers.len() {
        let s = signers.get(i).unwrap();
        for j in (i + 1)..signers.len() {
            if signers.get(j).unwrap() == s {
                return Err(MultisigError::DuplicateSigner);
            }
        }
    }
    if threshold < 2 || threshold > signers.len() {
        return Err(MultisigError::InvalidThreshold);
    }
    Ok(())
}

fn proposal_id(env: &Env, counter: u64) -> BytesN<32> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(counter.to_be_bytes());
    BytesN::from_array(env, &hasher.finalize().into())
}

fn next_counter(env: &Env) -> u64 {
    let counter: u64 = env.storage().instance().get(&next_id_key(env)).unwrap_or(0);
    env.storage()
        .instance()
        .set(&next_id_key(env), &(counter + 1));
    counter
}

fn bump_proposal_ttl(env: &Env, id: &BytesN<32>) {
    let key = proposal_key(id);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_LEDGERS, PERSISTENT_TTL_LEDGERS);
}

fn execute_proposal(env: &Env, proposal: &Proposal) {
    if proposal.is_rotation {
        // Already validated in `propose_rotation` — nothing about the new set
        // can become invalid between then and threshold being reached, since
        // validity depends only on the proposed data, not current state.
        env.storage().instance().set(
            &config_key(env),
            &MultisigConfig {
                signers: proposal.new_signers.clone(),
                threshold: proposal.new_threshold,
            },
        );
    } else {
        let args: Vec<Val> = env
            .storage()
            .persistent()
            .get(&args_key(&proposal.id))
            .unwrap_or_else(|| Vec::new(env));
        let _: Val = env.invoke_contract(&proposal.target, &proposal.fn_name, args);
    }
}

#[contractimpl]
impl MultisigAdmin {
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), MultisigError> {
        if env.storage().instance().has(&config_key(&env)) {
            return Err(MultisigError::AlreadyInitialized);
        }
        validate_signers_and_threshold(&signers, threshold)?;
        env.storage()
            .instance()
            .set(&config_key(&env), &MultisigConfig { signers, threshold });
        env.storage().instance().set(&next_id_key(&env), &0u64);
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<MultisigConfig, MultisigError> {
        load_config(&env)
    }

    pub fn get_signers(env: Env) -> Result<Vec<Address>, MultisigError> {
        Ok(load_config(&env)?.signers)
    }

    pub fn get_threshold(env: Env) -> Result<u32, MultisigError> {
        Ok(load_config(&env)?.threshold)
    }

    pub fn is_signer(env: Env, who: Address) -> bool {
        load_config(&env)
            .map(|cfg| cfg.signers.contains(who))
            .unwrap_or(false)
    }

    /// Propose invoking `fn_name(args)` on `target` — the generic path used
    /// for every registry admin operation (publish a root, pause a flow, set
    /// a config parameter, transfer admin to a different address, ...).
    /// `proposer` must be a current signer and must authorize this call.
    pub fn propose_call(
        env: Env,
        proposer: Address,
        target: Address,
        fn_name: Symbol,
        args: Vec<Val>,
    ) -> Result<BytesN<32>, MultisigError> {
        proposer.require_auth();
        let cfg = load_config(&env)?;
        if !cfg.signers.contains(proposer.clone()) {
            return Err(MultisigError::NotASigner);
        }
        let id = proposal_id(&env, next_counter(&env));
        env.storage().persistent().set(&args_key(&id), &args);

        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());
        let mut proposal = Proposal {
            id: id.clone(),
            is_rotation: false,
            target,
            fn_name,
            new_signers: Vec::new(&env),
            new_threshold: 0,
            proposer: proposer.clone(),
            approvals,
            executed: false,
            created_at: env.ledger().sequence(),
        };
        if proposal.approvals.len() >= cfg.threshold {
            execute_proposal(&env, &proposal);
            proposal.executed = true;
        }
        env.storage()
            .persistent()
            .set(&proposal_key(&id), &proposal);
        bump_proposal_ttl(&env, &id);

        env.events()
            .publish((Symbol::new(&env, "Proposed"),), (id.clone(), proposer));
        Ok(id)
    }

    /// Propose replacing this contract's own signer set and/or threshold —
    /// this contract's self-governance action. Goes through the exact same
    /// propose/approve/threshold path as `propose_call`.
    pub fn propose_rotation(
        env: Env,
        proposer: Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) -> Result<BytesN<32>, MultisigError> {
        proposer.require_auth();
        let cfg = load_config(&env)?;
        if !cfg.signers.contains(proposer.clone()) {
            return Err(MultisigError::NotASigner);
        }
        validate_signers_and_threshold(&new_signers, new_threshold)?;

        let id = proposal_id(&env, next_counter(&env));

        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());
        let mut proposal = Proposal {
            id: id.clone(),
            is_rotation: true,
            target: env.current_contract_address(),
            fn_name: Symbol::new(&env, "rotate_signers"),
            new_signers,
            new_threshold,
            proposer: proposer.clone(),
            approvals,
            executed: false,
            created_at: env.ledger().sequence(),
        };
        if proposal.approvals.len() >= cfg.threshold {
            execute_proposal(&env, &proposal);
            proposal.executed = true;
        }
        env.storage()
            .persistent()
            .set(&proposal_key(&id), &proposal);
        bump_proposal_ttl(&env, &id);

        env.events()
            .publish((Symbol::new(&env, "Proposed"),), (id.clone(), proposer));
        Ok(id)
    }

    /// Approve a pending proposal. Executes automatically once distinct
    /// signer approvals reach the configured threshold. Returns whether this
    /// call caused execution.
    pub fn approve(
        env: Env,
        signer: Address,
        proposal_id: BytesN<32>,
    ) -> Result<bool, MultisigError> {
        signer.require_auth();
        let cfg = load_config(&env)?;
        if !cfg.signers.contains(signer.clone()) {
            return Err(MultisigError::NotASigner);
        }
        let pkey = proposal_key(&proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&pkey)
            .ok_or(MultisigError::ProposalNotFound)?;
        if proposal.executed {
            return Err(MultisigError::AlreadyExecuted);
        }
        if proposal.approvals.contains(signer.clone()) {
            return Err(MultisigError::AlreadyApproved);
        }
        proposal.approvals.push_back(signer.clone());

        let executed = proposal.approvals.len() >= cfg.threshold;
        if executed {
            execute_proposal(&env, &proposal);
            proposal.executed = true;
        }
        env.storage().persistent().set(&pkey, &proposal);
        bump_proposal_ttl(&env, &proposal_id);

        env.events().publish(
            (Symbol::new(&env, "Approved"),),
            (proposal_id, signer, executed),
        );
        Ok(executed)
    }

    pub fn get_proposal(env: Env, proposal_id: BytesN<32>) -> Result<Proposal, MultisigError> {
        env.storage()
            .persistent()
            .get(&proposal_key(&proposal_id))
            .ok_or(MultisigError::ProposalNotFound)
    }

    /// The arguments a Call proposal will invoke `fn_name` with. Empty
    /// (and meaningless) for a RotateSigners proposal.
    pub fn get_proposal_args(env: Env, proposal_id: BytesN<32>) -> Vec<Val> {
        env.storage()
            .persistent()
            .get(&args_key(&proposal_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

#[cfg(test)]
mod test;
