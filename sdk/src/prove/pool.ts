/**
 * Privacy-pool withdrawal prover. Reconstructs the depth-20 Poseidon state/ASP
 * trees from the pool's leaves, assembles the v3 withdrawal witness, and produces
 * a Groth16 proof bundle for `privacy-pool.withdraw`.
 *
 * The Merkle tree and context binding byte-match the circuit and the contract.
 * Reading the on-chain leaves (Deposit/Withdraw events) is the caller's job: pass
 * the reconstructed `stateLeaves` + `depositIndices` (and the prover validates the
 * note against them). This keeps the prover pure and offline-testable.
 *
 * v1 supports FULL withdrawals (remainder = 0); the change leaf is a throwaway
 * zero-value commitment.
 */
import { Address } from "@stellar/stellar-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { bigIntToBytes32, toHex32 } from "../crypto/bytes";
import {
  BN254_R,
  POOL_TREE_DEPTH,
  getPoseidon,
  hashFields,
  newNoteSecrets,
  type PoolNote,
} from "../crypto/notes";
import { ArtifactError } from "../errors/index";
import type { ArtifactResolver } from "../artifacts/index";
import { serializeGroth16Proof, type Groth16ProofLike } from "./serialize";

type Poseidon = Parameters<typeof hashFields>[0];

/** Big-endian byte encoding of `v` in `len` bytes. */
function beBytes(v: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let n = v;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** Depth-20 Poseidon Merkle tree, byte-matching the contract / circuit / ASP. */
export class PoolMerkleTree {
  private readonly zero: bigint[];
  constructor(
    private readonly poseidon: Poseidon,
    private readonly leaves: bigint[],
    private readonly depth = POOL_TREE_DEPTH,
  ) {
    this.zero = [0n];
    for (let i = 0; i < depth; i++) {
      this.zero.push(hashFields(poseidon, [this.zero[i], this.zero[i]]));
    }
  }
  private rootFrom(start: number, level: number): bigint {
    if (start >= this.leaves.length) return this.zero[level];
    if (level === 0) return this.leaves[start];
    const half = 1 << (level - 1);
    const left = this.rootFrom(start, level - 1);
    const right = this.rootFrom(start + half, level - 1);
    return hashFields(this.poseidon, [left, right]);
  }
  root(): bigint {
    return this.rootFrom(0, this.depth);
  }
  private node(index: number, level: number): bigint {
    return this.rootFrom(index * (1 << level), level);
  }
  proof(index: number): { siblings: bigint[]; indices: number[] } {
    const siblings: bigint[] = [];
    const indices: number[] = [];
    let cur = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(this.node(cur ^ 1, level));
      indices.push(cur & 1);
      cur >>= 1;
    }
    return { siblings, indices };
  }
}

/**
 * Withdrawal context binding:
 * keccak256(recipient_xdr ‖ withdrawn(16) ‖ fee(16) ‖ relayer_xdr ‖ scope(8)) mod r.
 */
export function computeWithdrawContext(opts: {
  recipient: string;
  withdrawn: bigint;
  fee: bigint;
  relayer: string;
  scope: number;
}): bigint {
  const recXdr = new Uint8Array(new Address(opts.recipient).toScVal().toXDR());
  const relXdr = new Uint8Array(new Address(opts.relayer).toScVal().toXDR());
  const parts = [
    recXdr,
    beBytes(opts.withdrawn, 16),
    beBytes(opts.fee, 16),
    relXdr,
    beBytes(BigInt(opts.scope), 8),
  ];
  const preimage = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    preimage.set(p, o);
    o += p.length;
  }
  let v = 0n;
  for (const b of keccak_256(preimage)) v = (v << 8n) + BigInt(b);
  return v % BN254_R;
}

export interface PoolWithdrawProof {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  withdrawnValue: bigint;
  stateRoot: Uint8Array;
  aspRoot: Uint8Array;
  nullifierHash: Uint8Array;
  newCommitment: Uint8Array;
}

interface SnarkjsLike {
  groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasm: string | Uint8Array,
      zkey: string | Uint8Array,
    ): Promise<{ proof: Groth16ProofLike; publicSignals: string[] }>;
  };
}

async function loadSnarkjs(): Promise<SnarkjsLike> {
  try {
    return (await import("snarkjs")) as unknown as SnarkjsLike;
  } catch (cause) {
    throw new ArtifactError(
      "snarkjs is required for proof generation; install it as a peer dependency.",
      { cause },
    );
  }
}

/**
 * Generate a full-withdrawal proof for `note`, paying `recipient` (minus `fee` to
 * `relayer`). The caller supplies the reconstructed pool leaves: `stateLeaves`
 * (commitment per state-tree index) and `depositIndices` (state index of each
 * deposit, in ASP-tree order).
 */
export async function provePoolWithdraw(opts: {
  note: PoolNote;
  recipient: string;
  relayer: string;
  fee: bigint;
  scope: number;
  stateLeaves: bigint[];
  depositIndices: number[];
  artifacts: ArtifactResolver;
  snarkjs?: SnarkjsLike;
}): Promise<PoolWithdrawProof> {
  const { note } = opts;
  const value = BigInt(note.value);
  const withdrawnValue = value; // full withdrawal
  const remainder = 0n;

  const poseidon = await getPoseidon();
  const h = (xs: bigint[]) => hashFields(poseidon, xs);

  const aspLeafIndex = opts.depositIndices.indexOf(note.leafIndex);
  if (aspLeafIndex < 0) {
    throw new Error(`Leaf #${note.leafIndex} is not among the pool's deposits.`);
  }
  const onChain = opts.stateLeaves[note.leafIndex];
  if (onChain != null && toHex32(onChain).toLowerCase() !== note.commitment.toLowerCase()) {
    throw new Error(`Leaf #${note.leafIndex} commitment does not match this note.`);
  }

  const label = h([BigInt(opts.scope), BigInt(note.leafIndex)]);
  const aspLeaves = opts.depositIndices.map((i) => h([BigInt(opts.scope), BigInt(i)]));
  const stateTree = new PoolMerkleTree(poseidon, opts.stateLeaves);
  const aspTree = new PoolMerkleTree(poseidon, aspLeaves);
  const statePath = stateTree.proof(note.leafIndex);
  const aspPath = aspTree.proof(aspLeafIndex);

  const change = newNoteSecrets();
  const newPrecommit = h([BigInt(change.nullifier), BigInt(change.secret)]);
  const newCommitment = h([remainder, label, newPrecommit]);
  const nullifierHash = h([BigInt(note.nullifier)]);
  const context = computeWithdrawContext({
    recipient: opts.recipient,
    withdrawn: withdrawnValue,
    fee: opts.fee,
    relayer: opts.relayer,
    scope: opts.scope,
  });

  const input: Record<string, unknown> = {
    withdrawnValue: withdrawnValue.toString(),
    stateRoot: stateTree.root().toString(),
    aspRoot: aspTree.root().toString(),
    nullifierHash: nullifierHash.toString(),
    newCommitment: newCommitment.toString(),
    context: context.toString(),
    value: value.toString(),
    label: label.toString(),
    nullifier: note.nullifier,
    secret: note.secret,
    newNullifier: change.nullifier,
    newSecret: change.secret,
    stateSiblings: statePath.siblings.map((x) => x.toString()),
    stateIndex: statePath.indices.map((x) => x.toString()),
    aspSiblings: aspPath.siblings.map((x) => x.toString()),
    aspIndex: aspPath.indices.map((x) => x.toString()),
  };

  const snarkjs = opts.snarkjs ?? (await loadSnarkjs());
  const [wasm, zkey] = await Promise.all([
    opts.artifacts.resolve("pool-v3", "wasm"),
    opts.artifacts.resolve("pool-v3", "zkey"),
  ]);
  const { proof } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  const { a, b, c } = serializeGroth16Proof(proof);

  return {
    proofA: a,
    proofB: b,
    proofC: c,
    withdrawnValue,
    stateRoot: bigIntToBytes32(stateTree.root()),
    aspRoot: bigIntToBytes32(aspTree.root()),
    nullifierHash: bigIntToBytes32(nullifierHash),
    newCommitment: bigIntToBytes32(newCommitment),
  };
}
