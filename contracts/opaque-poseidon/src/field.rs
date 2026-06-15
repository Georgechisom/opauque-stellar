//! BN254 scalar-field arithmetic in Montgomery form, no_std and dependency-free.
//!
//! Elements are four little-endian u64 limbs. Multiplication is CIOS Montgomery
//! (radix 2^256); add/sub are plain with a conditional modulus subtraction. The
//! Montgomery constants (MODULUS, INV, R2) live in the generated `constants` module.
//!
//! `to_mont`/`from_mont` move between the standard integer representation (what
//! BytesN<32> carries on-chain and what circomlibjs hashes) and the in-domain
//! representation the permutation runs in.

use crate::constants::{INV, MODULUS, R2};

/// A BN254 scalar field element: four little-endian 64-bit limbs.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Fr(pub [u64; 4]);

impl Fr {
    pub const ZERO: Fr = Fr([0, 0, 0, 0]);

    /// Decode a 32-byte big-endian field element and reduce mod r.
    pub fn from_be_bytes(b: &[u8; 32]) -> Fr {
        let mut limbs = [0u64; 4];
        for i in 0..4 {
            let mut v = 0u64;
            for k in 0..8 {
                v = (v << 8) | b[i * 8 + k] as u64;
            }
            // b[0..8] is the most significant chunk -> top limb.
            limbs[3 - i] = v;
        }
        let mut r = Fr(limbs);
        // A 256-bit input is < 6r, so a handful of subtractions fully reduces it.
        while ge(&r.0, &MODULUS) {
            sub_assign(&mut r.0, &MODULUS);
        }
        r
    }

    /// Encode as a 32-byte big-endian field element.
    pub fn to_be_bytes(self) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..4 {
            out[i * 8..i * 8 + 8].copy_from_slice(&self.0[3 - i].to_be_bytes());
        }
        out
    }

    /// Standard integer (< r) -> Montgomery form (x·R mod r).
    #[inline]
    pub fn to_mont(self) -> Fr {
        montmul(&self, &R2)
    }

    /// Montgomery form -> standard integer (< r).
    #[inline]
    pub fn from_mont(self) -> Fr {
        montmul(&self, &Fr([1, 0, 0, 0]))
    }
}

/// Lexicographic >= on little-endian limbs.
#[inline]
fn ge(a: &[u64; 4], b: &[u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}

/// a -= b on little-endian limbs (caller guarantees a >= b).
#[inline]
fn sub_assign(a: &mut [u64; 4], b: &[u64; 4]) {
    let mut borrow = 0i128;
    for i in 0..4 {
        let d = (a[i] as i128) - (b[i] as i128) - borrow;
        if d < 0 {
            a[i] = (d + (1i128 << 64)) as u64;
            borrow = 1;
        } else {
            a[i] = d as u64;
            borrow = 0;
        }
    }
}

/// (a + b) mod r.
pub fn add(a: &Fr, b: &Fr) -> Fr {
    let mut r = [0u64; 4];
    let mut carry: u128 = 0;
    for i in 0..4 {
        let s = (a.0[i] as u128) + (b.0[i] as u128) + carry;
        r[i] = s as u64;
        carry = s >> 64;
    }
    // a,b < r < 2^254 so the sum is < 2^256 (carry==0) but may exceed r.
    if carry != 0 || ge(&r, &MODULUS) {
        sub_assign(&mut r, &MODULUS);
    }
    Fr(r)
}

/// CIOS Montgomery multiplication: returns a·b·R^{-1} mod r.
pub fn montmul(a: &Fr, b: &Fr) -> Fr {
    const S: usize = 4;
    let a = &a.0;
    let b = &b.0;
    let n = &MODULUS;
    let mut t = [0u64; S + 2];

    for i in 0..S {
        // t += a * b[i]
        let mut c: u64 = 0;
        for j in 0..S {
            let cs = (t[j] as u128) + (a[j] as u128) * (b[i] as u128) + (c as u128);
            t[j] = cs as u64;
            c = (cs >> 64) as u64;
        }
        let cs = (t[S] as u128) + (c as u128);
        t[S] = cs as u64;
        t[S + 1] = (cs >> 64) as u64;

        // m = t[0] * (-r^{-1}) mod 2^64
        let m = t[0].wrapping_mul(INV);

        // t = (t + m * n) >> 64  (the low limb cancels to zero by construction)
        let cs = (t[0] as u128) + (m as u128) * (n[0] as u128);
        let mut c2: u64 = (cs >> 64) as u64;
        for j in 1..S {
            let cs = (t[j] as u128) + (m as u128) * (n[j] as u128) + (c2 as u128);
            t[j - 1] = cs as u64;
            c2 = (cs >> 64) as u64;
        }
        let cs = (t[S] as u128) + (c2 as u128);
        t[S - 1] = cs as u64;
        t[S] = t[S + 1].wrapping_add((cs >> 64) as u64);
    }

    let mut r = [t[0], t[1], t[2], t[3]];
    if t[S] != 0 || ge(&r, n) {
        sub_assign(&mut r, n);
    }
    Fr(r)
}

/// x^5 in the Montgomery domain.
#[inline]
pub fn pow5(x: &Fr) -> Fr {
    let x2 = montmul(x, x);
    let x4 = montmul(&x2, &x2);
    montmul(&x4, x)
}
