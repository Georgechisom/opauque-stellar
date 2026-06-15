#![no_std]
//! Benchmark contract for the privacy-pool on-chain Poseidon cost (Task 5.1).
//!
//! `deposit_insert` performs exactly the hashing one pool `deposit` would:
//!   * `label      = Poseidon(scope, index)`        — 1 × Poseidon(2)
//!   * `commitment = Poseidon(value, label, precom)` — 1 × Poseidon(3)
//!   * incremental Merkle path                       — `depth` × Poseidon(2)
//! It returns the resulting root so the work can't be optimized away.

use opaque_poseidon::{poseidon2, poseidon3, u64_be32};
use soroban_sdk::{contract, contractimpl, BytesN, Env};

#[contract]
pub struct PoseidonBench;

#[contractimpl]
impl PoseidonBench {
    pub fn deposit_insert(
        env: Env,
        value: u64,
        precommitment: BytesN<32>,
        scope: u64,
        index: u64,
        depth: u32,
    ) -> BytesN<32> {
        let label = poseidon2(&u64_be32(scope), &u64_be32(index));
        let mut cur = poseidon3(&u64_be32(value), &label, &precommitment.to_array());
        let zero = [0u8; 32];
        for _ in 0..depth {
            cur = poseidon2(&cur, &zero);
        }
        BytesN::from_array(&env, &cur)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{BytesN, Env};

    const WASM: &[u8] =
        include_bytes!("../target/wasm32v1-none/release/poseidon_bench.wasm");

    /// Stellar mainnet per-transaction CPU instruction limit.
    const MAINNET_CPU_LIMIT: u64 = 100_000_000;

    fn measure(depth: u32) -> u64 {
        let env = Env::default();
        // Disable the post-invocation mainnet limit check, and lift the in-flight
        // fuel meter, so the call completes and we can read the true CPU number.
        env.cost_estimate().disable_resource_limits();
        env.cost_estimate().budget().reset_unlimited();
        let id = env.register_contract_wasm(None, WASM);
        let client = PoseidonBenchClient::new(&env, &id);
        let pre = BytesN::from_array(&env, &[7u8; 32]);
        // Reset right before the call so the number reflects one withdraw/deposit-style
        // invocation (VM instantiation + execution), excluding the one-time wasm upload.
        env.cost_estimate().budget().reset_unlimited();
        let _root = client.deposit_insert(&100u64, &pre, &1u64, &0u64, &depth);
        let cpu = env.cost_estimate().budget().cpu_instruction_cost();
        std::println!(
            "[bench] depth={depth:>2} cpu_insns={cpu:>12} mem_bytes={} (mainnet cap {MAINNET_CPU_LIMIT})",
            env.cost_estimate().budget().memory_bytes_cost(),
        );
        cpu
    }

    /// Gating-risk benchmark (Task 5.1). Records the measured cost and asserts the
    /// finding that drove the privacy-pool architecture: on-chain Poseidon Merkle
    /// insertion is INFEASIBLE within Soroban's 100M-instruction per-tx budget.
    ///
    /// Measured (soroban-sdk 25.3.1, opt-level=z wasm, this machine):
    ///   depth  1 (~3 hashes) ≈ 124M   depth  8 ≈ 366M
    ///   depth 16 ≈ 643M               depth 20 (~22 hashes) ≈ 782M
    ///
    /// ~40M CPU/hash — even one deposit's label+commitment hashing exceeds the cap.
    /// Conclusion: the pool publishes its state root OFF-CHAIN (like the ASP root)
    /// with an on-chain custody invariant; the contract does no Poseidon (the
    /// `context` binding uses the cheap host keccak256 instead).
    #[test]
    fn poseidon_insertion_exceeds_soroban_budget() {
        let mut last = 0u64;
        for depth in [1u32, 8, 16, 20] {
            let cpu = measure(depth);
            assert!(cpu >= last, "cost must grow with depth");
            last = cpu;
        }
        // Even the cheapest case (depth 1 ≈ 3 Poseidon hashes) blows the per-tx CPU
        // budget — confirming on-chain insertion is not viable at any tree depth.
        let cpu1 = measure(1);
        assert!(
            cpu1 > MAINNET_CPU_LIMIT,
            "expected on-chain Poseidon to exceed the {MAINNET_CPU_LIMIT} cap (got {cpu1}); \
             if this now fits, on-chain state-tree insertion may be reconsidered"
        );
    }
}
