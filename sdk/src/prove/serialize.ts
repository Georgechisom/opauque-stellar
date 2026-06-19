/**
 * Serialize a snarkjs Groth16 proof into the byte layout the Soroban verifiers
 * expect: A and C as 64-byte G1 points (x‖y, 32-byte BE each), B as a 128-byte
 * G2 point with each Fp2 coordinate pair swapped (c1‖c0). Shared by the
 * reputation and pool provers.
 */
import { bigIntToBytes32 } from "../crypto/bytes";

export interface Groth16ProofLike {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

export interface SerializedProof {
  a: Uint8Array; // 64 bytes
  b: Uint8Array; // 128 bytes
  c: Uint8Array; // 64 bytes
}

export function serializeGroth16Proof(proof: Groth16ProofLike): SerializedProof {
  const a = new Uint8Array(64);
  a.set(bigIntToBytes32(BigInt(proof.pi_a[0])), 0);
  a.set(bigIntToBytes32(BigInt(proof.pi_a[1])), 32);

  // G2: take the first two coordinate pairs, swapping (c1, c0) within each.
  const flat = proof.pi_b
    .slice(0, 2)
    .flatMap((pair) => [BigInt(pair[1]), BigInt(pair[0])]);
  const b = new Uint8Array(128);
  for (let i = 0; i < 4; i++) b.set(bigIntToBytes32(flat[i]), i * 32);

  const c = new Uint8Array(64);
  c.set(bigIntToBytes32(BigInt(proof.pi_c[0])), 0);
  c.set(bigIntToBytes32(BigInt(proof.pi_c[1])), 32);

  return { a, b, c };
}
