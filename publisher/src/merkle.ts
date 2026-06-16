/**
 * Depth-20 Poseidon(2) Merkle tree for V2 reputation leaf commitments.
 *
 * Leaves are already field elements. They are produced client-side as:
 * Poseidon(stealth_pk, schema_id, issuer_pk_x, trait_data_hash, nonce).
 */
import { buildPoseidon } from "circomlibjs";
import { bigintToHex32 } from "./bytes.ts";

export const TREE_DEPTH = 20;

let cachedPoseidon: any = null;
export async function getPoseidon(): Promise<any> {
  if (!cachedPoseidon) cachedPoseidon = await buildPoseidon();
  return cachedPoseidon;
}

export function hashFields(poseidon: any, inputs: bigint[]): bigint {
  return poseidon.F.toObject(poseidon(inputs));
}

export class MerkleTree {
  private readonly zero: bigint[];
  readonly leaves: bigint[] = [];

  constructor(private readonly poseidon: any, private readonly depth = TREE_DEPTH) {
    this.zero = [0n];
    for (let i = 0; i < depth; i += 1) {
      this.zero.push(hashFields(poseidon, [this.zero[i], this.zero[i]]));
    }
  }

  insert(leaf: bigint): number {
    if (this.leaves.length >= 1 << this.depth) throw new Error("reputation tree is full");
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

  rootHex(): string {
    return bigintToHex32(this.root());
  }
}

export async function buildRoot(leaves: string[]): Promise<string> {
  const poseidon = await getPoseidon();
  const tree = new MerkleTree(poseidon);
  for (const leaf of leaves) tree.insert(BigInt(leaf));
  return tree.rootHex();
}
