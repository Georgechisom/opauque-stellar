/**
 * Depth-20 Poseidon(2) Merkle tree over BN254, byte-identical to the Rust scanner
 * (scanner/src/merkle.rs), the frontend helper (frontend/scripts/lib/merkleV2.ts), and
 * the v3 circuit's inclusion check. Vendored here (rather than imported across
 * workspaces) so the ASP is self-contained and CI-clean; a vitest asserts it matches the
 * canonical circomlib roots.
 *
 * Leaf = the field element itself (for the ASP tree, a `label`); node = Poseidon(left,
 * right); empty leaf = 0; zero-subtree hash at level i = Poseidon(z[i-1], z[i-1]).
 */
import { buildPoseidon } from "circomlibjs";

export const TREE_DEPTH = 20;

let _poseidon: any = null;
export async function getPoseidon(): Promise<any> {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

export function hashFields(poseidon: any, inputs: bigint[]): bigint {
  return poseidon.F.toObject(poseidon(inputs));
}

/** bigint -> 0x-prefixed 32-byte big-endian hex. */
export function toHex32(v: bigint): string {
  return "0x" + v.toString(16).padStart(64, "0");
}

export class MerkleTree {
  poseidon: any;
  depth: number;
  leaves: bigint[] = [];
  zero: bigint[];

  constructor(poseidon: any, depth = TREE_DEPTH) {
    this.poseidon = poseidon;
    this.depth = depth;
    this.zero = [0n];
    for (let i = 0; i < depth; i++) {
      this.zero.push(hashFields(poseidon, [this.zero[i], this.zero[i]]));
    }
  }

  insert(leaf: bigint): number {
    if (this.leaves.length >= 1 << this.depth) throw new Error("tree full");
    this.leaves.push(leaf);
    return this.leaves.length - 1;
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

  /** Inclusion proof for the leaf at `index` (bottom-up siblings + direction bits). */
  proof(index: number): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
    if (index >= this.leaves.length) throw new Error(`leaf index ${index} out of bounds`);
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let cur = index;
    for (let level = 0; level < this.depth; level++) {
      pathElements.push(this.node(cur ^ 1, level));
      pathIndices.push(cur & 1);
      cur >>= 1;
    }
    return { pathElements, pathIndices, root: this.root() };
  }
}

/** label = Poseidon(scope, depositIndex). */
export function computeLabel(poseidon: any, scope: number | bigint, index: number | bigint): bigint {
  return hashFields(poseidon, [BigInt(scope), BigInt(index)]);
}
