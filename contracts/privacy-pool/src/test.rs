#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env,
};

// A mock groth16 verifier whose verify_proof_v3 returns a configurable verdict, so the
// pool logic (custody, roots, nullifiers, payout) is tested without a real proof.
#[contract]
struct MockVerifier;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum MockErr {
    X = 1,
}

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof_v3(
        env: Env,
        _a: BytesN<64>,
        _b: BytesN<128>,
        _c: BytesN<64>,
        _inputs: VerifyPublicInputsV3,
    ) -> Result<bool, MockErr> {
        Ok(env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "ok"))
            .unwrap_or(true))
    }
    pub fn set_ok(env: Env, ok: bool) {
        env.storage().instance().set(&Symbol::new(&env, "ok"), &ok);
    }
}

struct Harness {
    env: Env,
    admin: Address,
    pool: PrivacyPoolClient<'static>,
    sac: Address,
    mock: MockVerifierClient<'static>,
    pool_addr: Address,
}

fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let sac_addr = sac.address();

    let mock_addr = env.register(MockVerifier, ());
    let mock = MockVerifierClient::new(&env, &mock_addr);

    let pool_addr = env.register(PrivacyPool, ());
    let pool = PrivacyPoolClient::new(&env, &pool_addr);
    pool.initialize(&admin, &mock_addr, &sac_addr, &7u64);

    Harness {
        env,
        admin,
        pool,
        sac: sac_addr,
        mock,
        pool_addr,
    }
}

fn fund(h: &Harness, to: &Address, amount: i128) {
    token::StellarAssetClient::new(&h.env, &h.sac).mint(to, &amount);
}

fn bal(h: &Harness, who: &Address) -> i128 {
    token::TokenClient::new(&h.env, &h.sac).balance(who)
}

fn b32(env: &Env, tag: u8) -> BytesN<32> {
    BytesN::from_array(env, &[tag; 32])
}

fn publish_roots(h: &Harness) -> (BytesN<32>, BytesN<32>) {
    let sr = b32(&h.env, 0x51);
    let ar = b32(&h.env, 0xA1);
    h.pool.update_state_root(&h.admin, &sr, &b32(&h.env, 0xD1));
    h.pool.update_asp_root(&h.admin, &ar, &b32(&h.env, 0xD2));
    (sr, ar)
}

fn proof(env: &Env) -> (BytesN<64>, BytesN<128>, BytesN<64>) {
    (
        BytesN::from_array(env, &[0u8; 64]),
        BytesN::from_array(env, &[0u8; 128]),
        BytesN::from_array(env, &[0u8; 64]),
    )
}

#[test]
fn initialize_and_config() {
    let h = setup();
    let cfg = h.pool.get_config();
    assert_eq!(cfg.scope, 7);
    assert_eq!(cfg.native_sac, h.sac);
    assert_eq!(h.pool.get_deposit_count(), 0);
}

#[test]
fn initialize_twice_rejected() {
    let h = setup();
    let res = h.pool.try_initialize(&h.admin, &h.sac, &h.sac, &1u64);
    assert_eq!(res, Err(Ok(PoolError::AlreadyInitialized)));
}

#[test]
fn deposit_pulls_funds_and_records() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);

    let idx = h
        .pool
        .deposit(&depositor, &600i128, &b32(&h.env, 0xC1), &0u64);
    assert_eq!(idx, 0);
    assert_eq!(bal(&h, &depositor), 400);
    assert_eq!(bal(&h, &h.pool_addr), 600);
    assert_eq!(h.pool.get_deposit_count(), 1);
    assert_eq!(h.pool.get_custody(), (600, 0));
}

#[test]
fn deposit_wrong_index_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);
    let res = h
        .pool
        .try_deposit(&depositor, &100i128, &b32(&h.env, 0xC2), &5u64);
    assert_eq!(res, Err(Ok(PoolError::IndexMismatch)));
}

#[test]
fn deposit_bad_amount_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    let res = h
        .pool
        .try_deposit(&depositor, &0i128, &b32(&h.env, 0xC3), &0u64);
    assert_eq!(res, Err(Ok(PoolError::BadAmount)));
}

#[test]
fn update_roots_and_unauthorized() {
    let h = setup();
    h.pool
        .update_state_root(&h.admin, &b32(&h.env, 0x51), &b32(&h.env, 0xD1));
    h.pool
        .update_asp_root(&h.admin, &b32(&h.env, 0xA1), &b32(&h.env, 0xD2));
    assert!(h.pool.is_known_state_root(&b32(&h.env, 0x51)));
    assert!(h.pool.is_known_asp_root(&b32(&h.env, 0xA1)));
    assert_eq!(h.pool.get_latest_root(&true), b32(&h.env, 0x51));
    assert_eq!(h.pool.get_latest_root(&false), b32(&h.env, 0xA1));

    let stranger = Address::generate(&h.env);
    let res = h
        .pool
        .try_update_state_root(&stranger, &b32(&h.env, 0x52), &b32(&h.env, 0xD3));
    assert_eq!(res, Err(Ok(PoolError::Unauthorized)));
}

#[test]
fn withdraw_full_flow_pays_split_and_updates_state() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);
    h.pool
        .deposit(&depositor, &1000i128, &b32(&h.env, 0xC1), &0u64);
    let (sr, ar) = publish_roots(&h);

    let recipient = Address::generate(&h.env);
    let relayer = Address::generate(&h.env);
    let (pa, pb, pc) = proof(&h.env);
    let nullifier = b32(&h.env, 0x9A);
    let new_commit = b32(&h.env, 0xCE);

    h.pool.withdraw(
        &pa,
        &pb,
        &pc,
        &400i128,
        &sr,
        &ar,
        &nullifier,
        &new_commit,
        &recipient,
        &10i128,
        &relayer,
    );

    assert_eq!(bal(&h, &recipient), 390); // 400 - 10 fee
    assert_eq!(bal(&h, &relayer), 10);
    assert_eq!(bal(&h, &h.pool_addr), 600); // 1000 - 400 paid out
    assert!(h.pool.is_spent(&nullifier));
    assert_eq!(h.pool.get_custody(), (1000, 400));
    // remainder commitment re-inserted as the next leaf (index 1).
    assert_eq!(h.pool.get_deposit_count(), 2);
}

#[test]
fn withdraw_nullifier_replay_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);
    h.pool
        .deposit(&depositor, &1000i128, &b32(&h.env, 0xC1), &0u64);
    let (sr, ar) = publish_roots(&h);
    let recipient = Address::generate(&h.env);
    let relayer = Address::generate(&h.env);
    let (pa, pb, pc) = proof(&h.env);
    let nullifier = b32(&h.env, 0x9A);

    h.pool.withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &sr,
        &ar,
        &nullifier,
        &b32(&h.env, 0xCE),
        &recipient,
        &0i128,
        &relayer,
    );
    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &sr,
        &ar,
        &nullifier,
        &b32(&h.env, 0xCF),
        &recipient,
        &0i128,
        &relayer,
    );
    assert_eq!(res, Err(Ok(PoolError::NullifierUsed)));
}

#[test]
fn withdraw_unknown_roots_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);
    h.pool
        .deposit(&depositor, &1000i128, &b32(&h.env, 0xC1), &0u64);
    let (sr, ar) = publish_roots(&h);
    let recipient = Address::generate(&h.env);
    let relayer = Address::generate(&h.env);
    let (pa, pb, pc) = proof(&h.env);

    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &b32(&h.env, 0xEE),
        &ar,
        &b32(&h.env, 0x01),
        &b32(&h.env, 0xCE),
        &recipient,
        &0i128,
        &relayer,
    );
    assert_eq!(res, Err(Ok(PoolError::UnknownStateRoot)));

    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &sr,
        &b32(&h.env, 0xEF),
        &b32(&h.env, 0x02),
        &b32(&h.env, 0xCE),
        &recipient,
        &0i128,
        &relayer,
    );
    assert_eq!(res, Err(Ok(PoolError::UnknownAspRoot)));
}

#[test]
fn withdraw_expired_root_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);
    h.pool
        .deposit(&depositor, &1000i128, &b32(&h.env, 0xC1), &0u64);
    let (sr, ar) = publish_roots(&h);
    h.pool.set_root_expiry(&h.admin, &10u32);
    h.env.ledger().set_sequence_number(50);

    let (pa, pb, pc) = proof(&h.env);
    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &sr,
        &ar,
        &b32(&h.env, 0x03),
        &b32(&h.env, 0xCE),
        &Address::generate(&h.env),
        &0i128,
        &Address::generate(&h.env),
    );
    assert_eq!(res, Err(Ok(PoolError::RootExpired)));
}

#[test]
fn withdraw_invalid_proof_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 1000);
    h.pool
        .deposit(&depositor, &1000i128, &b32(&h.env, 0xC1), &0u64);
    let (sr, ar) = publish_roots(&h);
    h.mock.set_ok(&false);

    let (pa, pb, pc) = proof(&h.env);
    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &sr,
        &ar,
        &b32(&h.env, 0x04),
        &b32(&h.env, 0xCE),
        &Address::generate(&h.env),
        &0i128,
        &Address::generate(&h.env),
    );
    assert_eq!(res, Err(Ok(PoolError::InvalidProof)));
}

#[test]
fn withdraw_custody_violation_rejected() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    fund(&h, &depositor, 100);
    h.pool
        .deposit(&depositor, &100i128, &b32(&h.env, 0xC1), &0u64);
    let (sr, ar) = publish_roots(&h);

    let (pa, pb, pc) = proof(&h.env);
    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &200i128,
        &sr,
        &ar,
        &b32(&h.env, 0x05),
        &b32(&h.env, 0xCE),
        &Address::generate(&h.env),
        &0i128,
        &Address::generate(&h.env),
    );
    assert_eq!(res, Err(Ok(PoolError::CustodyViolation)));
}

#[test]
fn withdraw_bad_amount_rejected() {
    let h = setup();
    let (sr, ar) = publish_roots(&h);
    let (pa, pb, pc) = proof(&h.env);
    let res = h.pool.try_withdraw(
        &pa,
        &pb,
        &pc,
        &100i128,
        &sr,
        &ar,
        &b32(&h.env, 0x06),
        &b32(&h.env, 0xCE),
        &Address::generate(&h.env),
        &200i128,
        &Address::generate(&h.env),
    );
    assert_eq!(res, Err(Ok(PoolError::BadAmount)));
}
