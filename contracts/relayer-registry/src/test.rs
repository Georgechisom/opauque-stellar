#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env,
};

#[contract]
struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn withdraw(
        env: Env,
        _proof_a: BytesN<64>,
        _proof_b: BytesN<128>,
        _proof_c: BytesN<64>,
        withdrawn_value: i128,
        _state_root: BytesN<32>,
        _asp_root: BytesN<32>,
        nullifier_hash: BytesN<32>,
        _new_commitment: BytesN<32>,
        recipient: Address,
        _fee: i128,
        relayer: Address,
    ) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "called"), &true);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "withdrawn"), &withdrawn_value);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "nullifier"), &nullifier_hash);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "recipient"), &recipient);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "relayer"), &relayer);
    }

    pub fn called(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "called"))
            .unwrap_or(false)
    }
}

struct Harness {
    env: Env,
    admin: Address,
    registry: RelayerRegistryClient<'static>,
    registry_addr: Address,
    pool: MockPoolClient<'static>,
    pool_addr: Address,
    sac: Address,
}

struct Payload {
    proof_a: BytesN<64>,
    proof_b: BytesN<128>,
    proof_c: BytesN<64>,
    withdrawn_value: i128,
    state_root: BytesN<32>,
    asp_root: BytesN<32>,
    nullifier_hash: BytesN<32>,
    new_commitment: BytesN<32>,
    recipient: Address,
    pool_fee: i128,
    pool_relayer: Address,
}

fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.sequence_number = 100);

    let admin = Address::generate(&env);
    let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = sac_contract.address();
    let pool_addr = env.register(MockPool, ());
    let pool = MockPoolClient::new(&env, &pool_addr);
    let registry_addr = env.register(RelayerRegistry, ());
    let registry = RelayerRegistryClient::new(&env, &registry_addr);
    registry.initialize(&admin, &sac, &pool_addr, &100i128, &10u32, &100u32);

    Harness {
        env,
        admin,
        registry,
        registry_addr,
        pool,
        pool_addr,
        sac,
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

fn b64(env: &Env, tag: u8) -> BytesN<64> {
    BytesN::from_array(env, &[tag; 64])
}

fn b128(env: &Env, tag: u8) -> BytesN<128> {
    BytesN::from_array(env, &[tag; 128])
}

fn addr(env: &Env, s: &str) -> Address {
    Address::from_string(&String::from_str(env, s))
}

fn hex32(env: &Env, hex: &str) -> BytesN<32> {
    let clean = hex.strip_prefix("0x").unwrap_or(hex);
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&clean[i * 2..i * 2 + 2], 16).unwrap();
    }
    BytesN::from_array(env, &out)
}

fn register_relayer(h: &Harness, stake: i128) -> Address {
    let operator = Address::generate(&h.env);
    fund(h, &operator, stake);
    h.registry.register(
        &operator,
        &b32(&h.env, 0x88),
        &String::from_str(&h.env, "http://127.0.0.1:8787"),
        &stake,
    );
    operator
}

fn payload(h: &Harness, relayer: &Address) -> Payload {
    Payload {
        proof_a: b64(&h.env, 0xA1),
        proof_b: b128(&h.env, 0xB2),
        proof_c: b64(&h.env, 0xC3),
        withdrawn_value: 500,
        state_root: b32(&h.env, 0x51),
        asp_root: b32(&h.env, 0xA5),
        nullifier_hash: b32(&h.env, 0x9A),
        new_commitment: b32(&h.env, 0xCE),
        recipient: Address::generate(&h.env),
        pool_fee: 0,
        pool_relayer: relayer.clone(),
    }
}

fn hash_payload(h: &Harness, p: &Payload) -> BytesN<32> {
    h.registry.hash_pool_withdraw_payload(
        &p.proof_a,
        &p.proof_b,
        &p.proof_c,
        &p.withdrawn_value,
        &p.state_root,
        &p.asp_root,
        &p.nullifier_hash,
        &p.new_commitment,
        &p.recipient,
        &p.pool_fee,
        &p.pool_relayer,
    )
}

fn create_job(h: &Harness, creator: &Address, job_id: &BytesN<32>, hash: &BytesN<32>, fee: i128) {
    fund(h, creator, fee);
    h.registry.create_job(creator, job_id, hash, &150u32, &fee);
}

#[test]
fn initialize_and_config() {
    let h = setup();
    let cfg = h.registry.get_config();
    assert_eq!(cfg.admin, h.admin);
    assert_eq!(cfg.native_sac, h.sac);
    assert_eq!(cfg.privacy_pool, h.pool_addr);
    assert_eq!(cfg.minimum_stake, 100);
}

#[test]
fn register_stakes_and_rejects_under_minimum() {
    let h = setup();
    let operator = Address::generate(&h.env);
    fund(&h, &operator, 99);
    let res = h.registry.try_register(
        &operator,
        &b32(&h.env, 0x88),
        &String::from_str(&h.env, "http://localhost"),
        &99i128,
    );
    assert_eq!(res, Err(Ok(RegistryError::StakeTooLow)));

    let operator = register_relayer(&h, 500);
    let record = h.registry.get_relayer(&operator);
    assert_eq!(record.free_stake, 500);
    assert_eq!(bal(&h, &operator), 0);
    assert_eq!(bal(&h, &h.registry_addr), 500);
}

#[test]
fn add_request_and_withdraw_stake_obeys_cooldown() {
    let h = setup();
    let operator = register_relayer(&h, 500);
    fund(&h, &operator, 100);
    h.registry.add_stake(&operator, &100i128);
    assert_eq!(h.registry.get_relayer(&operator).free_stake, 600);

    h.registry.request_unstake(&operator, &200i128);
    let record = h.registry.get_relayer(&operator);
    assert_eq!(record.free_stake, 400);
    assert_eq!(record.pending_unstake, 200);

    let locked = h.registry.try_withdraw_stake(&operator);
    assert_eq!(locked, Err(Ok(RegistryError::UnstakeLocked)));

    h.env.ledger().with_mut(|li| li.sequence_number = 111);
    h.registry.withdraw_stake(&operator);
    assert_eq!(bal(&h, &operator), 200);
    assert_eq!(h.registry.get_relayer(&operator).pending_unstake, 0);
}

#[test]
fn create_accept_submit_pool_withdraw_pays_and_releases_bond() {
    let h = setup();
    let operator = register_relayer(&h, 1_000);
    let creator = Address::generate(&h.env);
    let job_id = b32(&h.env, 0x01);
    let p = payload(&h, &operator);
    create_job(&h, &creator, &job_id, &hash_payload(&h, &p), 100);

    h.registry.accept_job(&operator, &job_id);
    let accepted = h.registry.get_relayer(&operator);
    assert_eq!(accepted.free_stake, 900);
    assert_eq!(accepted.bonded_stake, 100);

    h.registry.submit_pool_withdraw(
        &operator,
        &job_id,
        &p.proof_a,
        &p.proof_b,
        &p.proof_c,
        &p.withdrawn_value,
        &p.state_root,
        &p.asp_root,
        &p.nullifier_hash,
        &p.new_commitment,
        &p.recipient,
        &p.pool_fee,
        &p.pool_relayer,
    );

    assert!(h.pool.called());
    assert_eq!(h.registry.get_job(&job_id).status, STATUS_SUBMITTED);
    let relayer = h.registry.get_relayer(&operator);
    assert_eq!(relayer.free_stake, 1_000);
    assert_eq!(relayer.bonded_stake, 0);
    assert_eq!(bal(&h, &operator), 100);
    assert_eq!(bal(&h, &h.registry_addr), 1_000);
}

#[test]
fn submit_rejects_hash_mismatch_before_pool_call() {
    let h = setup();
    let operator = register_relayer(&h, 1_000);
    let creator = Address::generate(&h.env);
    let job_id = b32(&h.env, 0x02);
    create_job(&h, &creator, &job_id, &b32(&h.env, 0xFF), 100);
    h.registry.accept_job(&operator, &job_id);
    let p = payload(&h, &operator);

    let res = h.registry.try_submit_pool_withdraw(
        &operator,
        &job_id,
        &p.proof_a,
        &p.proof_b,
        &p.proof_c,
        &p.withdrawn_value,
        &p.state_root,
        &p.asp_root,
        &p.nullifier_hash,
        &p.new_commitment,
        &p.recipient,
        &p.pool_fee,
        &p.pool_relayer,
    );
    assert_eq!(res, Err(Ok(RegistryError::PayloadHashMismatch)));
    assert!(!h.pool.called());
}

#[test]
fn wrong_relayer_cannot_submit() {
    let h = setup();
    let operator = register_relayer(&h, 1_000);
    let other = register_relayer(&h, 1_000);
    let creator = Address::generate(&h.env);
    let job_id = b32(&h.env, 0x03);
    let p = payload(&h, &operator);
    create_job(&h, &creator, &job_id, &hash_payload(&h, &p), 100);
    h.registry.accept_job(&operator, &job_id);

    let res = h.registry.try_submit_pool_withdraw(
        &other,
        &job_id,
        &p.proof_a,
        &p.proof_b,
        &p.proof_c,
        &p.withdrawn_value,
        &p.state_root,
        &p.asp_root,
        &p.nullifier_hash,
        &p.new_commitment,
        &p.recipient,
        &p.pool_fee,
        &p.pool_relayer,
    );
    assert_eq!(res, Err(Ok(RegistryError::WrongRelayer)));
}

#[test]
fn accepted_job_can_be_slashed_after_deadline() {
    let h = setup();
    let operator = register_relayer(&h, 1_000);
    let creator = Address::generate(&h.env);
    let job_id = b32(&h.env, 0x04);
    let p = payload(&h, &operator);
    create_job(&h, &creator, &job_id, &hash_payload(&h, &p), 100);
    h.registry.accept_job(&operator, &job_id);

    let early = h.registry.try_slash_job(&creator, &job_id);
    assert_eq!(early, Err(Ok(RegistryError::DeadlineNotPassed)));

    h.env.ledger().with_mut(|li| li.sequence_number = 151);
    h.registry.slash_job(&creator, &job_id);
    assert_eq!(h.registry.get_job(&job_id).status, STATUS_SLASHED);
    assert_eq!(h.registry.get_relayer(&operator).bonded_stake, 0);
    assert_eq!(h.registry.get_relayer(&operator).free_stake, 900);
    assert_eq!(bal(&h, &creator), 200);
}

#[test]
fn unaccepted_job_can_be_canceled_after_deadline() {
    let h = setup();
    let creator = Address::generate(&h.env);
    let job_id = b32(&h.env, 0x05);
    create_job(&h, &creator, &job_id, &b32(&h.env, 0x10), 100);

    let early = h.registry.try_cancel_job(&creator, &job_id);
    assert_eq!(early, Err(Ok(RegistryError::DeadlineNotPassed)));

    h.env.ledger().with_mut(|li| li.sequence_number = 151);
    h.registry.cancel_job(&creator, &job_id);
    assert_eq!(h.registry.get_job(&job_id).status, STATUS_CANCELED);
    assert_eq!(bal(&h, &creator), 100);
}

#[test]
fn deadline_and_double_accept_are_rejected() {
    let h = setup();
    let operator = register_relayer(&h, 1_000);
    let creator = Address::generate(&h.env);
    fund(&h, &creator, 100);
    let bad = h.registry.try_create_job(
        &creator,
        &b32(&h.env, 0x06),
        &b32(&h.env, 0x10),
        &99u32,
        &100i128,
    );
    assert_eq!(bad, Err(Ok(RegistryError::BadDeadline)));

    let job_id = b32(&h.env, 0x07);
    let p = payload(&h, &operator);
    create_job(&h, &creator, &job_id, &hash_payload(&h, &p), 100);
    h.registry.accept_job(&operator, &job_id);
    let again = h.registry.try_accept_job(&operator, &job_id);
    assert_eq!(again, Err(Ok(RegistryError::JobNotOpen)));
}

#[test]
fn pool_withdraw_payload_hash_matches_typescript_fixture() {
    let env = Env::default();
    let pool = addr(
        &env,
        "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
    );
    let recipient = addr(
        &env,
        "GABTYFQAXDR724JAJSNZVUH56T62JJ7CLWT6YL56ME7OPA4DIIMAMOI6",
    );
    let relayer = addr(
        &env,
        "GDKPRDH3AGALVIZ3OX5LJGNIXZOWUBCIX5HA36YXOSQOGEZLDCJOSGDR",
    );
    let hash = pool_withdraw_payload_hash(
        &env,
        &pool,
        &b64(&env, 0xA1),
        &b128(&env, 0xB2),
        &b64(&env, 0xC3),
        500,
        &b32(&env, 0x51),
        &b32(&env, 0xA5),
        &b32(&env, 0x9A),
        &b32(&env, 0xCE),
        &recipient,
        0,
        &relayer,
    );
    assert_eq!(
        hash,
        hex32(
            &env,
            "94f0acd43cc1f0b9afcc760a9a03699c5f18f52fdb6ec3044455feb3b39599d2",
        ),
    );
}
