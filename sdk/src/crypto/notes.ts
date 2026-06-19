/**
 * Privacy-pool note model and cryptographic derivation.
 *
 * A note is the client-side spending material for one pooled commitment. Losing
 * it loses the funds, so notes must be persisted and backed up. A note holds only
 * the depositor's own secrets and reveals nothing on-chain (the commitment is a
 * hash).
 *
 * Derivations (byte-match circuits/v3 + the privacy-pool contract):
 *   label         = Poseidon(scope, leafIndex)
 *   precommitment = Poseidon(nullifier, secret)
 *   commitment    = Poseidon(value, label, precommitment)
 *   nullifierHash = Poseidon(nullifier)
 */
export const POOL_TREE_DEPTH = 20;
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type PoolNote = {
  /** Network cluster this note belongs to. */
  cluster: string;
  /** Privacy-pool contract this note belongs to. Legacy notes may omit this. */
  poolId?: string;
  /** Deposited value, in stroops, as a decimal string. */
  value: string;
  /** Domain separator the deposit was made under. */
  scope: number;
  /** Leaf index assigned by the contract at deposit time. */
  leafIndex: number;
  /** Field-element secrets (decimal strings). */
  nullifier: string;
  secret: string;
  /** Derived commitment (0x-prefixed 32-byte hex), the state-tree leaf. */
  commitment: string;
  /** Whether this note has been spent (withdrawn). */
  spent: boolean;
  createdAt: number;
};

type PoseidonFn = { F: { toObject: (x: unknown) => bigint } } & ((
  i: bigint[],
) => unknown);

let _poseidon: PoseidonFn | null = null;

/** Lazily build (and cache) the circomlibjs Poseidon instance. */
export async function getPoseidon(): Promise<PoseidonFn> {
  if (!_poseidon) {
    // circomlibjs touches Buffer; ensure it exists before loading (browsers).
    if (typeof globalThis !== "undefined" && !("Buffer" in globalThis)) {
      const bufferPkg = await import("buffer/index.js");
      (globalThis as Record<string, unknown>).Buffer = bufferPkg.Buffer;
    }
    // Lazy import: circomlibjs is an optional peer dep, only needed for
    // pool/reputation Poseidon hashing — not for payments-only consumers.
    let buildPoseidon: () => Promise<unknown>;
    try {
      ({ buildPoseidon } = await import("circomlibjs"));
    } catch (cause) {
      throw new Error(
        "circomlibjs is required for pool/reputation hashing; install it as a peer dependency.",
        { cause },
      );
    }
    _poseidon = (await buildPoseidon()) as PoseidonFn;
  }
  return _poseidon;
}

/** Hash a list of field elements with Poseidon, returning the field result. */
export function hashFields(poseidon: PoseidonFn, inputs: bigint[]): bigint {
  return poseidon.F.toObject(poseidon(inputs));
}

/** Cryptographically-random field element < r (decimal string). */
export function randomFieldElement(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) + BigInt(b);
  return (v % BN254_R).toString();
}

export type DerivedDeposit = {
  label: bigint;
  precommitment: bigint;
  commitment: bigint;
  nullifierHash: bigint;
};

/** Derive the commitment material for one deposit from its secrets. */
export async function deriveDeposit(opts: {
  value: bigint;
  scope: number;
  leafIndex: number;
  nullifier: bigint;
  secret: bigint;
}): Promise<DerivedDeposit> {
  const poseidon = await getPoseidon();
  const h = (xs: bigint[]) => hashFields(poseidon, xs);
  const label = h([BigInt(opts.scope), BigInt(opts.leafIndex)]);
  const precommitment = h([opts.nullifier, opts.secret]);
  const commitment = h([opts.value, label, precommitment]);
  const nullifierHash = h([opts.nullifier]);
  return { label, precommitment, commitment, nullifierHash };
}

/** Build a fresh note's secrets (commitment is filled once the leaf index is known). */
export function newNoteSecrets(): { nullifier: string; secret: string } {
  return { nullifier: randomFieldElement(), secret: randomFieldElement() };
}

/** Unspent total across notes, in stroops. */
export function unspentTotal(notes: PoolNote[]): bigint {
  return notes
    .filter((n) => !n.spent)
    .reduce((sum, n) => sum + BigInt(n.value), 0n);
}
