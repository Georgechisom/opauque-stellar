/**
 * Reputation prover: orchestrates witness generation (WASM) and
 * ZK proof generation (snarkjs) for stealth attestations.
 *
 * Also provides the on-chain submit helper that calls the
 * ReputationVerifier Soroban contract.
 */

import type { OpaqueWasmModule } from "../hooks/useOpaqueWasm";
import type { ProofData, DiscoveredTrait } from "./reputation";
import { reputationAddresses } from "../contracts/reputationAddresses";
import { BASE_FEE, Contract, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { bytesToScVal, getSorobanServer, invokeContractMethod, u64ToScVal } from "./stellar";
import type { SignTxFn } from "./stellar";
import { getNetworkPassphrase } from "./chain";
import { publicAssetPath } from "./publicAssets";
// @ts-expect-error snarkjs has no bundled types
import * as snarkjs from "snarkjs";

const CIRCUIT_WASM_PATH = publicAssetPath("circuits/v2/stealth_reputation.wasm");
const ZKEY_PATH = publicAssetPath("circuits/v2/stealth_reputation_final.zkey");
const TREE_DEPTH = 20;

const REPUTATION_CONTRACT_ID = reputationAddresses.reputationVerifier;
export const REPUTATION_ROOT_UNAVAILABLE_MESSAGE =
  "No current reputation Merkle root is published for this verifier. " +
  "The root publisher/indexer must publish a root that includes this attestation before on-chain verification can run.";

export type ProofProgressCallback = (stage: string, percent: number) => void;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) + BigInt(b);
  return result;
}

/**
 * Build a witness for the canonical V2 reputation circuit
 * (circuits/v2/stealth_reputation.circom).
 *
 * Phase 2 uses a contrived single-leaf tree-of-zeros (the holder's leaf at index 0),
 * and derives the private trait fields (issuer_pk_x, trait_data_hash, nonce)
 * deterministically. Phase 3 replaces this with the real indexed attestation set via
 * the scanner's scan_attestations_v2 / generate_reputation_witness_v2, and a published
 * Merkle root the proof verifies against.
 */
async function buildV2Witness(
  traitAttestationId: number,
  stealthPrivKeyBytes: Uint8Array,
  externalNullifier: string,
) {
  if (typeof globalThis !== "undefined" && !("Buffer" in globalThis)) {
    const bufferPkg = await import("buffer/index.js");
    (globalThis as { Buffer?: typeof bufferPkg.Buffer }).Buffer = bufferPkg.Buffer;
  }
  const circomlib = await import("circomlibjs");
  const poseidon = await circomlib.buildPoseidon();
  const F = poseidon.F;

  const stealthPk = F.toObject(F.e(bytesToBigInt(stealthPrivKeyBytes)));
  const schemaId = BigInt(traitAttestationId); // attestation_id == schema_id
  const extNullifier = BigInt(externalNullifier);

  // Derived private inputs (Phase 2 placeholder; Phase 3 supplies real values).
  const issuerPkX = F.toObject(poseidon([stealthPk, 1n]));
  const traitDataHash = F.toObject(poseidon([schemaId, 2n]));
  const nonce = F.toObject(poseidon([stealthPk, 3n]));

  // leaf = Poseidon(stealth_pk, schema_id, issuer_pk_x, trait_data_hash, nonce)
  const leaf = F.toObject(poseidon([stealthPk, schemaId, issuerPkX, traitDataHash, nonce]));

  // Zero-subtree hashes (empty-subtree roots): z[0] = 0, z[i] = Poseidon(z[i-1], z[i-1]).
  // For the holder's leaf at index 0 of an otherwise-empty tree these are the sibling
  // values, matching the scanner / Phase 3 indexer tree (scanner/src/merkle.rs). Phase 3
  // serves the real inclusion path for multi-leaf sets; this single-leaf path is the
  // degenerate case and produces the same root the indexer publishes.
  const zeroHashes: bigint[] = [0n];
  for (let i = 0; i < TREE_DEPTH; i++) {
    zeroHashes.push(F.toObject(poseidon([zeroHashes[i], zeroHashes[i]])));
  }
  const merklePath: string[] = [];
  const merklePathIndices: number[] = [];
  let current = leaf;
  for (let i = 0; i < TREE_DEPTH; i++) {
    merklePath.push(zeroHashes[i].toString());
    merklePathIndices.push(0);
    current = F.toObject(poseidon([current, zeroHashes[i]]));
  }
  const merkleRoot = current;
  const nullifierHash = F.toObject(poseidon([stealthPk, extNullifier]));

  return {
    stealth_pk: stealthPk.toString(),
    schema_id: schemaId.toString(),
    issuer_pk_x: issuerPkX.toString(),
    trait_data_hash: traitDataHash.toString(),
    nonce: nonce.toString(),
    merkle_path: merklePath,
    merkle_path_indices: merklePathIndices,
    merkle_root: merkleRoot.toString(),
    attestation_id: schemaId.toString(),
    external_nullifier: extNullifier.toString(),
    nullifier_hash: nullifierHash.toString(),
  };
}

/**
 * Full proof generation pipeline:
 * 1. Generate witness via WASM
 * 2. Generate Groth16 proof via snarkjs
 */
export async function generateReputationProof(
  _wasm: OpaqueWasmModule,
  trait: DiscoveredTrait,
  _allAttestationsJson: string,
  stealthPrivKeyBytes: Uint8Array,
  externalNullifier: string,
  onProgress: ProofProgressCallback,
): Promise<ProofData> {
  onProgress("preparing-witness", 10);

  const witness = await buildV2Witness(
    trait.attestationId,
    stealthPrivKeyBytes,
    externalNullifier
  );

  onProgress("preparing-witness", 70);
  onProgress("generating-proof", 75);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    CIRCUIT_WASM_PATH,
    ZKEY_PATH,
  );

  onProgress("generating-proof", 95);

  // V2 public signal order (canonical, see docs/PUBLIC_SIGNALS.md):
  //   [0] merkle_root  [1] attestation_id  [2] external_nullifier  [3] nullifier_hash
  // Must match circuits/v2/stealth_reputation.circom and contracts/reputation-verifier
  // (verify_proof_v2). The on-chain `nullifier` argument is this nullifier_hash.
  const nullifier = publicSignals[3];
  const attestationIdFromProof = BigInt(publicSignals[1]);

  return {
    proof: {
      pi_a: proof.pi_a.slice(0, 2),
      pi_b: proof.pi_b.slice(0, 2),
      pi_c: proof.pi_c.slice(0, 2),
    },
    publicSignals,
    nullifier,
    attestationId: attestationIdFromProof,
  };
}

// =============================================================================
// On-chain submission (Stellar Soroban)
// =============================================================================

function bigIntToBytes32(val: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let n = val;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

function bytes32ToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  return n;
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${label} must fit in u64 for the reputation verifier contract.`);
  }
}

function assertU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} must fit in u32 for the reputation verifier contract.`);
  }
}

export function isReputationRootUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /get_latest_root/i.test(message) &&
    /Error\(Contract,\s*#2\)|Contract#2|Contract,\s*#2|RootExpired/i.test(message)
  );
}

/**
 * Fetch the latest valid Merkle root from the on-chain root history
 * by simulating the `get_latest_root` view function on the ReputationVerifier contract.
 */
export async function fetchLatestValidMerkleRoot(sourcePublicKey: string): Promise<Uint8Array> {
  const server = getSorobanServer();
  const passphrase = getNetworkPassphrase();
  const source = await server.getAccount(sourcePublicKey);
  const contract = new Contract(REPUTATION_CONTRACT_ID);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call("get_latest_root"))
    .setTimeout(30)
    .build();
  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await server.simulateTransaction(tx);
  } catch (err) {
    if (isReputationRootUnavailableError(err)) {
      throw new Error(REPUTATION_ROOT_UNAVAILABLE_MESSAGE);
    }
    throw err;
  }
  if (rpc.Api.isSimulationError(sim)) {
    if (isReputationRootUnavailableError(sim.error)) {
      throw new Error(REPUTATION_ROOT_UNAVAILABLE_MESSAGE);
    }
    throw new Error(`Could not fetch latest reputation Merkle root: ${sim.error}`);
  }
  if (!sim.result?.retval) {
    throw new Error(REPUTATION_ROOT_UNAVAILABLE_MESSAGE);
  }
  const retval = sim.result.retval;
  const v = retval as { bytes?: () => Buffer };
  if (!v.bytes) {
    throw new Error("Unexpected response from contract when fetching Merkle root.");
  }
  const rootBytes = Uint8Array.from(v.bytes());
  const isZero = rootBytes.every((b) => b === 0);
  if (isZero) {
    throw new Error("Latest Merkle root is invalid (all zeros).");
  }
  return rootBytes;
}

/**
 * Submits a proof to the ReputationVerifier Soroban contract.
 */
export async function submitProofOnChain(
  proofData: ProofData,
  merkleRoot: string,
  externalNullifier: string,
  signTransaction: SignTxFn,
  publicKey: string,
  expirationLedger = 0,
): Promise<string> {
  const rootBytes = bigIntToBytes32(BigInt(merkleRoot));
  const nullifierBytes = bigIntToBytes32(BigInt(proofData.nullifier));
  const attestationIdBytes = bigIntToBytes32(
    BigInt(proofData.publicSignals[1] ?? proofData.attestationId),
  );
  const externalNullifierValue = BigInt(externalNullifier);

  assertU64(externalNullifierValue, "external_nullifier");
  assertU32(expirationLedger, "expiration_ledger");

  const latestRoot = await fetchLatestValidMerkleRoot(publicKey);
  if (bytes32ToBigInt(latestRoot) !== bytes32ToBigInt(rootBytes)) {
    throw new Error(
      "Merkle root mismatch: this proof was generated against a local or stale root. " +
        "Regenerate after the root publisher/indexer has published a root that includes this attestation.",
    );
  }

  const pi_a = proofData.proof.pi_a.map(BigInt);
  const pi_b_flat = proofData.proof.pi_b.flatMap((pair) => [BigInt(pair[1]), BigInt(pair[0])]);
  const pi_c = proofData.proof.pi_c.map(BigInt);

  const proofA = new Uint8Array(64);
  proofA.set(bigIntToBytes32(pi_a[0]), 0);
  proofA.set(bigIntToBytes32(pi_a[1]), 32);
  const proofB = new Uint8Array(128);
  for (let i = 0; i < 4; i++) proofB.set(bigIntToBytes32(pi_b_flat[i]), i * 32);
  const proofC = new Uint8Array(64);
  proofC.set(bigIntToBytes32(pi_c[0]), 0);
  proofC.set(bigIntToBytes32(pi_c[1]), 32);

  return invokeContractMethod({
    sourcePublicKey: publicKey,
    contractId: REPUTATION_CONTRACT_ID,
    method: "verify_reputation",
    args: [
      nativeToScVal(publicKey, { type: "address" }),
      nativeToScVal(reputationAddresses.groth16Verifier, { type: "address" }),
      bytesToScVal(proofA),
      bytesToScVal(proofB),
      bytesToScVal(proofC),
      nativeToScVal(Buffer.from(rootBytes), { type: "bytes" }),
      nativeToScVal(Buffer.from(attestationIdBytes), { type: "bytes" }),
      u64ToScVal(externalNullifierValue),
      nativeToScVal(Buffer.from(nullifierBytes), { type: "bytes" }),
      nativeToScVal(expirationLedger, { type: "u32" }),
    ],
    signTransaction,
  });
}
