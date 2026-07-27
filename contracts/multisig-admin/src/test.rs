#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal,
};

// A minimal target contract standing in for a registry's admin-gated function.
// `set_value` mirrors the shape of a real admin op: it takes the caller as an
// explicit Address and calls `require_auth()` on it, so this test proves the
// multisig contract's own outgoing call satisfies that check with no separate
// signature — exactly how a registry's `admin.require_auth()` will behave once
// `admin` is the multisig contract's address.
#[contract]
struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn set_value(env: Env, caller: Address, value: u32) {
        caller.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "value"), &value);
    }

    pub fn get_value(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "value"))
            .unwrap_or(0)
    }
}

struct Harness {
    env: Env,
    multisig: MultisigAdminClient<'static>,
    multisig_addr: Address,
    signers: std::vec::Vec<Address>,
    target: MockTargetClient<'static>,
    target_addr: Address,
}

fn setup(num_signers: u32, threshold: u32) -> Harness {
    let env = Env::default();
    env.mock_all_auths();

    let mut signers = std::vec::Vec::new();
    let mut signer_vec = Vec::new(&env);
    for _ in 0..num_signers {
        let s = Address::generate(&env);
        signer_vec.push_back(s.clone());
        signers.push(s);
    }

    let multisig_addr = env.register(MultisigAdmin, ());
    let multisig = MultisigAdminClient::new(&env, &multisig_addr);
    multisig.initialize(&signer_vec, &threshold);

    let target_addr = env.register(MockTarget, ());
    let target = MockTargetClient::new(&env, &target_addr);

    Harness {
        env,
        multisig,
        multisig_addr,
        signers,
        target,
        target_addr,
    }
}

/// Proposes a `set_value(multisig_addr, value)` call on the mock target —
/// stands in for a registry admin op like `publish_root(admin, root, hash)`.
fn propose_set_value(h: &Harness, proposer: &Address, value: u32) -> BytesN<32> {
    let args: Vec<Val> = (h.multisig_addr.clone(), value).into_val(&h.env);
    h.multisig.propose_call(
        proposer,
        &h.target_addr,
        &Symbol::new(&h.env, "set_value"),
        &args,
    )
}

// -- initialize validation ---------------------------------------------------

#[test]
fn initialize_rejects_single_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let only = Address::generate(&env);
    let id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(&env, &id);
    let signers = Vec::from_array(&env, [only]);
    let res = client.try_initialize(&signers, &1u32);
    assert_eq!(res, Err(Ok(MultisigError::InsufficientSigners)));
}

#[test]
fn initialize_rejects_threshold_of_one() {
    let env = Env::default();
    env.mock_all_auths();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(&env, &id);
    let signers = Vec::from_array(&env, [a, b]);
    let res = client.try_initialize(&signers, &1u32);
    assert_eq!(res, Err(Ok(MultisigError::InvalidThreshold)));
}

#[test]
fn initialize_rejects_threshold_exceeding_signers() {
    let env = Env::default();
    env.mock_all_auths();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(&env, &id);
    let signers = Vec::from_array(&env, [a, b]);
    let res = client.try_initialize(&signers, &3u32);
    assert_eq!(res, Err(Ok(MultisigError::InvalidThreshold)));
}

#[test]
fn initialize_rejects_duplicate_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let a = Address::generate(&env);
    let id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(&env, &id);
    let signers = Vec::from_array(&env, [a.clone(), a]);
    let res = client.try_initialize(&signers, &2u32);
    assert_eq!(res, Err(Ok(MultisigError::DuplicateSigner)));
}

#[test]
fn initialize_twice_rejected() {
    let h = setup(3, 2);
    let res = h.multisig.try_initialize(
        &Vec::from_array(
            &h.env,
            [Address::generate(&h.env), Address::generate(&h.env)],
        ),
        &2u32,
    );
    assert_eq!(res, Err(Ok(MultisigError::AlreadyInitialized)));
}

// -- propose_call --------------------------------------------------------------

#[test]
fn propose_by_non_signer_rejected() {
    let h = setup(3, 2);
    let stranger = Address::generate(&h.env);
    let args: Vec<Val> = (h.multisig_addr.clone(), 7u32).into_val(&h.env);
    let res = h.multisig.try_propose_call(
        &stranger,
        &h.target_addr,
        &Symbol::new(&h.env, "set_value"),
        &args,
    );
    assert_eq!(res, Err(Ok(MultisigError::NotASigner)));
}

#[test]
fn propose_records_proposer_approval_but_does_not_execute_below_threshold() {
    let h = setup(3, 2);
    let id = propose_set_value(&h, &h.signers[0], 7);
    let proposal = h.multisig.get_proposal(&id);
    assert_eq!(proposal.approvals.len(), 1);
    assert_eq!(proposal.approvals.get(0).unwrap(), h.signers[0].clone());
    assert!(!proposal.executed);
    assert_eq!(h.target.get_value(), 0);
}

// -- approve / threshold execution --------------------------------------------

#[test]
fn threshold_reached_executes_the_call() {
    let h = setup(3, 2);
    let id = propose_set_value(&h, &h.signers[0], 42);
    assert_eq!(h.target.get_value(), 0);

    let executed = h.multisig.approve(&h.signers[1], &id);
    assert!(executed);
    assert_eq!(h.target.get_value(), 42);

    let proposal = h.multisig.get_proposal(&id);
    assert!(proposal.executed);
}

#[test]
fn two_of_three_threshold_executes_on_second_distinct_approval() {
    let h = setup(3, 2);
    let id = propose_set_value(&h, &h.signers[0], 5);
    let executed = h.multisig.approve(&h.signers[1], &id);
    assert!(executed);
    assert_eq!(h.target.get_value(), 5);
    // The third signer never needed to approve.
    let proposal = h.multisig.get_proposal(&id);
    assert_eq!(proposal.approvals.len(), 2);
    assert_eq!(proposal.approvals.get(0).unwrap(), h.signers[0].clone());
    assert_eq!(proposal.approvals.get(1).unwrap(), h.signers[1].clone());
}

#[test]
fn approve_by_non_signer_rejected() {
    let h = setup(3, 2);
    let id = propose_set_value(&h, &h.signers[0], 1);
    let stranger = Address::generate(&h.env);
    let res = h.multisig.try_approve(&stranger, &id);
    assert_eq!(res, Err(Ok(MultisigError::NotASigner)));
}

#[test]
fn approve_unknown_proposal_rejected() {
    let h = setup(3, 2);
    let fake_id = BytesN::from_array(&h.env, &[0xEEu8; 32]);
    let res = h.multisig.try_approve(&h.signers[0], &fake_id);
    assert_eq!(res, Err(Ok(MultisigError::ProposalNotFound)));
}

#[test]
fn double_approve_rejected() {
    let h = setup(3, 3);
    let id = propose_set_value(&h, &h.signers[0], 1);
    let res = h.multisig.try_approve(&h.signers[0], &id);
    assert_eq!(res, Err(Ok(MultisigError::AlreadyApproved)));
}

#[test]
fn approve_after_executed_rejected() {
    let h = setup(3, 2);
    let id = propose_set_value(&h, &h.signers[0], 9);
    h.multisig.approve(&h.signers[1], &id);
    let res = h.multisig.try_approve(&h.signers[2], &id);
    assert_eq!(res, Err(Ok(MultisigError::AlreadyExecuted)));
}

// -- signer rotation ------------------------------------------------------------

#[test]
fn rotate_signers_via_threshold_updates_config() {
    let h = setup(3, 2);
    let new_a = Address::generate(&h.env);
    let new_b = Address::generate(&h.env);
    let new_c = Address::generate(&h.env);
    let new_signers = Vec::from_array(&h.env, [new_a.clone(), new_b.clone(), new_c.clone()]);
    let id = h
        .multisig
        .propose_rotation(&h.signers[0], &new_signers, &3u32);
    let executed = h.multisig.approve(&h.signers[1], &id);
    assert!(executed);

    let cfg = h.multisig.get_config();
    assert_eq!(cfg.threshold, 3);
    assert!(cfg.signers.contains(new_a));
    assert!(cfg.signers.contains(new_b));
    assert!(cfg.signers.contains(new_c));
    // Old signers are no longer recognized.
    assert!(!h.multisig.is_signer(&h.signers[0]));
}

#[test]
fn rotate_signers_rejects_degenerate_new_config_at_propose_time() {
    let h = setup(3, 2);
    let only = Address::generate(&h.env);
    let new_signers = Vec::from_array(&h.env, [only]);
    let res = h
        .multisig
        .try_propose_rotation(&h.signers[0], &new_signers, &1u32);
    assert_eq!(res, Err(Ok(MultisigError::InsufficientSigners)));
    // Original config is untouched.
    let cfg = h.multisig.get_config();
    assert_eq!(cfg.threshold, 2);
}

#[test]
fn rotated_signer_set_governs_subsequent_proposals() {
    let h = setup(3, 2);
    let new_a = Address::generate(&h.env);
    let new_b = Address::generate(&h.env);
    let new_signers = Vec::from_array(&h.env, [new_a.clone(), new_b.clone()]);
    let id = h
        .multisig
        .propose_rotation(&h.signers[0], &new_signers, &2u32);
    h.multisig.approve(&h.signers[1], &id);

    // An old signer can no longer propose.
    let args: Vec<Val> = (h.multisig_addr.clone(), 3u32).into_val(&h.env);
    let res = h.multisig.try_propose_call(
        &h.signers[2],
        &h.target_addr,
        &Symbol::new(&h.env, "set_value"),
        &args,
    );
    assert_eq!(res, Err(Ok(MultisigError::NotASigner)));

    // A new signer can.
    let id2 = propose_set_value(&h, &new_a, 3);
    let executed = h.multisig.approve(&new_b, &id2);
    assert!(executed);
    assert_eq!(h.target.get_value(), 3);
}

// -- config reads ---------------------------------------------------------------

#[test]
fn get_config_reflects_initialization() {
    let h = setup(4, 3);
    let cfg = h.multisig.get_config();
    assert_eq!(cfg.threshold, 3);
    assert_eq!(cfg.signers.len(), 4);
    assert_eq!(h.multisig.get_threshold(), 3u32);
    assert_eq!(h.multisig.get_signers().len(), 4);
}

#[test]
fn queries_before_initialize_report_not_initialized() {
    let env = Env::default();
    let id = env.register(MultisigAdmin, ());
    let client = MultisigAdminClient::new(&env, &id);
    assert_eq!(
        client.try_get_config(),
        Err(Ok(MultisigError::NotInitialized))
    );
}

// -- real authorization (no mock_all_auths) --------------------------------------
//
// Every other test uses env.mock_all_auths(), which accepts require_auth() for
// ANY address — including the multisig contract's own address when it calls
// into a target. That would silently hide a broken assumption about Soroban's
// authorization model. This test uses only targeted, per-signer mock_auths
// (via the client's mock_auths() builder) covering exactly the two human
// signer approvals, with no separate authorization entry for the multisig
// contract's own direct call into MockTarget — proving that hop is authorized
// by Soroban itself (a contract's direct calls are always considered
// authorized), not by test-harness leniency.

#[test]
fn multisig_direct_call_needs_no_separate_signature_beyond_signer_approvals() {
    let env = Env::default();

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let signer_vec = Vec::from_array(&env, [a.clone(), b.clone(), c.clone()]);

    let multisig_addr = env.register(MultisigAdmin, ());
    let multisig = MultisigAdminClient::new(&env, &multisig_addr);
    // initialize() takes no signer argument and calls no require_auth, so it
    // needs no mocking regardless.
    multisig.initialize(&signer_vec, &2u32);

    let target_addr = env.register(MockTarget, ());
    let target = MockTargetClient::new(&env, &target_addr);

    let call_args: Vec<Val> = (multisig_addr.clone(), 99u32).into_val(&env);
    let fn_name = Symbol::new(&env, "set_value");

    let propose_args: Vec<Val> = (
        a.clone(),
        target_addr.clone(),
        fn_name.clone(),
        call_args.clone(),
    )
        .into_val(&env);
    let id = multisig
        .mock_auths(&[MockAuth {
            address: &a,
            invoke: &MockAuthInvoke {
                contract: &multisig_addr,
                fn_name: "propose_call",
                args: propose_args,
                sub_invokes: &[],
            },
        }])
        .propose_call(&a, &target_addr, &fn_name, &call_args);

    let approve_args: Vec<Val> = (b.clone(), id.clone()).into_val(&env);
    let executed = multisig
        .mock_auths(&[MockAuth {
            address: &b,
            invoke: &MockAuthInvoke {
                contract: &multisig_addr,
                fn_name: "approve",
                args: approve_args,
                sub_invokes: &[],
            },
        }])
        .approve(&b, &id);

    assert!(executed);
    assert_eq!(target.get_value(), 99);
}
