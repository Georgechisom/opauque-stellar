pragma circom 2.1.6;

// =============================================================================
// Privacy Pool Withdraw Circuit — V3 (Opaque Cash)
//
// Proves the right to withdraw part of a pooled deposit without revealing which
// deposit is being spent. Mirrors opaquecash/spec privacy-pool.md:
//
//   precommitment  = Poseidon(nullifier, secret)
//   commitment     = Poseidon(value, label, precommitment)        (state-tree leaf)
//   nullifierHash  = Poseidon(nullifier)                          (on-chain spent set)
//   remainder      = value - withdrawnValue                       (range-checked >= 0)
//   newPrecommit   = Poseidon(newNullifier, newSecret)
//   newCommitment  = Poseidon(remainder, label, newPrecommit)     (re-inserted leaf)
//
// The proof attests:
//   (a) `commitment` is a leaf of the pool STATE tree (root = stateRoot), and
//   (b) its `label` is a leaf of the ASSOCIATION tree (root = aspRoot),
// binding the same `nullifier`/`label` across both — so a withdrawal must come
// from a deposit that the ASP has marked clean. `context` is bound (Tornado-style)
// so a relayer cannot redirect funds or alter the fee.
//
// Public signals (order is load-bearing — must match verify_proof_v3 + the prover):
//   withdrawnValue, stateRoot, aspRoot, nullifierHash, newCommitment, context
// =============================================================================

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// Merkle inclusion of `leaf` at the given path, returning the computed root.
template MerkleInclusion(levels) {
    signal input leaf;
    signal input siblings[levels];
    signal input pathIndices[levels];   // 0 = leaf is left child, 1 = right
    signal output root;

    component hashers[levels];
    component muxL[levels];
    component muxR[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;  // binary

        muxL[i] = Mux1();
        muxL[i].c[0] <== cur[i];
        muxL[i].c[1] <== siblings[i];
        muxL[i].s <== pathIndices[i];

        muxR[i] = Mux1();
        muxR[i].c[0] <== siblings[i];
        muxR[i].c[1] <== cur[i];
        muxR[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxL[i].out;
        hashers[i].inputs[1] <== muxR[i].out;
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[levels];
}

template PrivacyPoolWithdraw(levels, valueBits) {
    // ── Public inputs (declared first so they lead the public-signal vector) ──
    signal input withdrawnValue;
    signal input stateRoot;
    signal input aspRoot;
    signal input nullifierHash;
    signal input newCommitment;
    signal input context;

    // ── Private inputs ────────────────────────────────────────────────────────
    signal input value;
    signal input label;
    signal input nullifier;
    signal input secret;
    signal input newNullifier;
    signal input newSecret;
    signal input stateSiblings[levels];
    signal input stateIndex[levels];
    signal input aspSiblings[levels];
    signal input aspIndex[levels];

    // ── Reconstruct the spent commitment ────────────────────────────────────────
    component pre = Poseidon(2);
    pre.inputs[0] <== nullifier;
    pre.inputs[1] <== secret;

    component commit = Poseidon(3);
    commit.inputs[0] <== value;
    commit.inputs[1] <== label;
    commit.inputs[2] <== pre.out;

    // ── State-tree inclusion of the commitment ──────────────────────────────────
    component stateProof = MerkleInclusion(levels);
    stateProof.leaf <== commit.out;
    for (var i = 0; i < levels; i++) {
        stateProof.siblings[i] <== stateSiblings[i];
        stateProof.pathIndices[i] <== stateIndex[i];
    }
    stateProof.root === stateRoot;

    // ── ASP-tree inclusion of the label ─────────────────────────────────────────
    component aspProof = MerkleInclusion(levels);
    aspProof.leaf <== label;
    for (var i = 0; i < levels; i++) {
        aspProof.siblings[i] <== aspSiblings[i];
        aspProof.pathIndices[i] <== aspIndex[i];
    }
    aspProof.root === aspRoot;

    // ── Nullifier binding ───────────────────────────────────────────────────────
    component nh = Poseidon(1);
    nh.inputs[0] <== nullifier;
    nh.out === nullifierHash;

    // ── Range-checked partial withdrawal (no underflow) ──────────────────────────
    // value and withdrawnValue must be valueBits-bit non-negative integers, and
    // withdrawnValue <= value, so remainder is a valid non-negative field element.
    component valueRange = Num2Bits(valueBits);
    valueRange.in <== value;
    component wRange = Num2Bits(valueBits);
    wRange.in <== withdrawnValue;

    component le = LessEqThan(valueBits);
    le.in[0] <== withdrawnValue;
    le.in[1] <== value;
    le.out === 1;

    signal remainder;
    remainder <== value - withdrawnValue;

    // ── Re-insertion commitment for the remainder (same label) ───────────────────
    component newPre = Poseidon(2);
    newPre.inputs[0] <== newNullifier;
    newPre.inputs[1] <== newSecret;

    component newCommit = Poseidon(3);
    newCommit.inputs[0] <== remainder;
    newCommit.inputs[1] <== label;
    newCommit.inputs[2] <== newPre.out;
    newCommit.out === newCommitment;

    // ── Context binding (front-running / fee-tamper protection) ───────────────────
    // The contract recomputes context = keccak256(recipient ∥ withdrawnValue ∥ fee ∥
    // relayer ∥ scope) mod p and checks it equals this public input. A squaring
    // constraint binds it into the proof so it cannot be altered post-hoc.
    signal contextSq;
    contextSq <== context * context;
}

// Depth-20 trees (~1M leaves); 64-bit values (XLM stroop supply < 2^60).
// Public signals: withdrawnValue, stateRoot, aspRoot, nullifierHash, newCommitment, context
component main {public [
    withdrawnValue,
    stateRoot,
    aspRoot,
    nullifierHash,
    newCommitment,
    context
]} = PrivacyPoolWithdraw(20, 64);
