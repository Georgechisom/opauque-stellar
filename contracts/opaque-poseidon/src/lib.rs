//! # opaque-poseidon
//!
//! A no_std, dependency-free Poseidon hash over the BN254 scalar field, byte-for-byte
//! compatible with circomlib (`poseidon.circom`), circomlibjs (`buildPoseidon`), and
//! the scanner's `poseidon-bn128`. It exists because those implementations are not
//! `no_std`/Soroban-ready, and the privacy-pool contract must hash on-chain to keep
//! its commitment Merkle tree authoritative.
//!
//! Only the two arities the pool needs are exposed:
//!   * [`poseidon2`] — `Poseidon(2)` for Merkle node hashing and `label`.
//!   * [`poseidon3`] — `Poseidon(3)` for the deposit `commitment`.
//!
//! Inputs and outputs are 32-byte big-endian field elements, matching `BytesN<32>`.
//! The permutation matches `poseidon_reference.js` exactly:
//!   state = [0, inputs...]; for each round: add round constants, apply the S-box
//!   (x^5 — full on the first/last `N_ROUNDS_F/2` rounds, partial otherwise), then
//!   mix by the MDS matrix `new[i] = Σ_j M[i][j]·state[j]`. Output is `state[0]`.

#![cfg_attr(not(test), no_std)]

mod constants;
mod field;

use constants::{
    C_T3, C_T4, M_T3, M_T4, N_ROUNDS_F, N_ROUNDS_P_T3, N_ROUNDS_P_T4,
};
use field::{add, pow5, Fr};

/// Hades permutation over a width-`T` state, in the Montgomery domain.
fn permute<const T: usize>(
    state: &mut [Fr; T],
    c: &[Fr],
    m: &[[Fr; T]; T],
    n_rounds_p: usize,
) {
    let total = N_ROUNDS_F + n_rounds_p;
    let half_f = N_ROUNDS_F / 2;
    for r in 0..total {
        // ARK: add round constants.
        for i in 0..T {
            state[i] = add(&state[i], &c[r * T + i]);
        }
        // S-box: full rounds at the start and end, partial in the middle.
        if r < half_f || r >= half_f + n_rounds_p {
            for i in 0..T {
                state[i] = pow5(&state[i]);
            }
        } else {
            state[0] = pow5(&state[0]);
        }
        // MDS mix: new[i] = Σ_j M[i][j] · state[j].
        let mut ns = [Fr::ZERO; T];
        for i in 0..T {
            let mut acc = Fr::ZERO;
            for j in 0..T {
                acc = add(&acc, &field::montmul(&m[i][j], &state[j]));
            }
            ns[i] = acc;
        }
        *state = ns;
    }
}

/// Poseidon(2): `H(a, b)` over BN254, returning a 32-byte big-endian field element.
pub fn poseidon2(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut state = [
        Fr::ZERO, // initState = 0, already in-domain (mont(0) == 0)
        Fr::from_be_bytes(a).to_mont(),
        Fr::from_be_bytes(b).to_mont(),
    ];
    permute::<3>(&mut state, &C_T3, &M_T3, N_ROUNDS_P_T3);
    state[0].from_mont().to_be_bytes()
}

/// Poseidon(3): `H(a, b, c)` over BN254, returning a 32-byte big-endian field element.
pub fn poseidon3(a: &[u8; 32], b: &[u8; 32], c: &[u8; 32]) -> [u8; 32] {
    let mut state = [
        Fr::ZERO,
        Fr::from_be_bytes(a).to_mont(),
        Fr::from_be_bytes(b).to_mont(),
        Fr::from_be_bytes(c).to_mont(),
    ];
    permute::<4>(&mut state, &C_T4, &M_T4, N_ROUNDS_P_T4);
    state[0].from_mont().to_be_bytes()
}

/// Convenience: hash a single u64 plus a 32-byte element as Poseidon(2). Useful for
/// `label = Poseidon(scope, deposit_index)` where both fit in a small integer.
pub fn poseidon2_u64(a: u64, b: u64) -> [u8; 32] {
    poseidon2(&u64_be32(a), &u64_be32(b))
}

/// u64 -> 32-byte big-endian field element.
pub fn u64_be32(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&v.to_be_bytes());
    out
}

#[cfg(test)]
mod test {
    use super::*;

    /// decimal field element -> 32-byte big-endian.
    fn dec_be32(dec: &str) -> [u8; 32] {
        // Parse a base-10 string into 32 big-endian bytes (test-only, std available).
        let mut acc = [0u8; 32];
        for ch in dec.bytes() {
            let d = (ch - b'0') as u16;
            // acc = acc * 10 + d
            let mut carry = d;
            for i in (0..32).rev() {
                let v = acc[i] as u16 * 10 + carry;
                acc[i] = (v & 0xff) as u8;
                carry = v >> 8;
            }
        }
        acc
    }

    fn be32_to_dec(b: &[u8; 32]) -> String {
        // Convert 32 big-endian bytes to a base-10 string (test-only).
        let mut digits = [0u8; 80];
        let mut len = 1usize;
        digits[0] = 0;
        for &byte in b.iter() {
            let mut carry = byte as u32;
            for i in 0..len {
                let v = (digits[i] as u32) * 256 + carry;
                digits[i] = (v % 10) as u8;
                carry = v / 10;
            }
            while carry > 0 {
                digits[len] = (carry % 10) as u8;
                carry /= 10;
                len += 1;
            }
        }
        let mut s = String::new();
        for i in (0..len).rev() {
            s.push((b'0' + digits[i]) as char);
        }
        s
    }

    #[test]
    fn poseidon2_matches_circomlib_1_2() {
        // Canonical circomlib vector: Poseidon([1,2]).
        let got = poseidon2(&dec_be32("1"), &dec_be32("2"));
        assert_eq!(
            be32_to_dec(&got),
            "7853200120776062878684798364095072458815029376092732009249414926327459813530"
        );
    }

    #[test]
    fn poseidon2_matches_circomlib_0_0() {
        let got = poseidon2(&dec_be32("0"), &dec_be32("0"));
        assert_eq!(
            be32_to_dec(&got),
            "14744269619966411208579211824598458697587494354926760081771325075741142829156"
        );
    }

    #[test]
    fn poseidon3_matches_circomlib_1_2_3() {
        let got = poseidon3(&dec_be32("1"), &dec_be32("2"), &dec_be32("3"));
        assert_eq!(
            be32_to_dec(&got),
            "6542985608222806190361240322586112750744169038454362455181422643027100751666"
        );
    }

    #[test]
    fn poseidon3_matches_circomlib_7_42_9() {
        let got = poseidon3(&dec_be32("7"), &dec_be32("42"), &dec_be32("9"));
        assert_eq!(
            be32_to_dec(&got),
            "8668106083036326207221183282473460177088944417407523250360549718661651708706"
        );
    }

    #[test]
    fn field_roundtrip_be_bytes() {
        let d = dec_be32("123456789012345678901234567890");
        let fr = Fr::from_be_bytes(&d);
        assert_eq!(fr.to_be_bytes(), d);
    }

    #[test]
    fn mont_roundtrip_identity() {
        let d = dec_be32("999999999999999999999999999");
        let fr = Fr::from_be_bytes(&d);
        assert_eq!(fr.to_mont().from_mont(), fr);
    }
}
