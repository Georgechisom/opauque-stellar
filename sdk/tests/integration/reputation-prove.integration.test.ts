/**
 * Real proof generation, gated on the circuit artifacts being present locally
 * (they ship via a release, not the package, and are absent in a bare CI run).
 * Generates a Groth16 V2 reputation proof with snarkjs and checks the serialized
 * bundle matches the contract's expected byte layout and public signals.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReputationWitnessV2,
  proveReputationV2,
  fileArtifactResolver,
} from "../../src/index";

const PUBLIC_DIR = resolve(process.cwd(), "../frontend/public");
const WASM = resolve(PUBLIC_DIR, "circuits/v2/stealth_reputation.wasm");
const ZKEY = resolve(PUBLIC_DIR, "circuits/v2/stealth_reputation_final.zkey");
const HAVE_ARTIFACTS = existsSync(WASM) && existsSync(ZKEY);

describe.skipIf(!HAVE_ARTIFACTS)("reputation prover (real artifacts)", () => {
  it("generates a Groth16 proof and serializes it for the contract", async () => {
    const input = {
      attestationId: 7,
      stealthPrivKey: new Uint8Array(32).fill(3),
      externalNullifier: 99n,
    };
    const artifacts = fileArtifactResolver({ baseDir: PUBLIC_DIR });

    const witness = await buildReputationWitnessV2(input);
    const bundle = await proveReputationV2({ input, artifacts });

    expect(bundle.proofA.length).toBe(64);
    expect(bundle.proofB.length).toBe(128);
    expect(bundle.proofC.length).toBe(64);
    expect(bundle.merkleRoot.length).toBe(32);
    expect(bundle.attestationId.length).toBe(32);
    expect(bundle.nullifierHash.length).toBe(32);
    expect(bundle.externalNullifier).toBe(99n);

    // Public-signal order: [merkle_root, attestation_id, external_nullifier, nullifier_hash].
    expect(bundle.publicSignals.length).toBe(4);
    expect(bundle.publicSignals[0]).toBe(witness.merkle_root);
    expect(bundle.publicSignals[1]).toBe("7");
    expect(bundle.publicSignals[2]).toBe("99");
  }, 120_000);
});
