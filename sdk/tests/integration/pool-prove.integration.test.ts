/**
 * Real privacy-pool withdrawal proof, gated on the v3 circuit artifacts being
 * present locally. Builds a single-leaf pool (the note's own commitment),
 * generates a full-withdrawal proof with snarkjs, and checks the serialized
 * bundle. Proves the witness assembly satisfies the v3 circuit offline.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveDeposit,
  newNoteSecrets,
  toHex32,
  fileArtifactResolver,
  provePoolWithdraw,
  type PoolNote,
} from "../../src/index";

const PUBLIC_DIR = resolve(process.cwd(), "../frontend/public");
const WASM = resolve(PUBLIC_DIR, "circuits/v3/privacy_pool_withdraw.wasm");
const ZKEY = resolve(PUBLIC_DIR, "circuits/v3/privacy_pool_withdraw_final.zkey");
const HAVE_ARTIFACTS = existsSync(WASM) && existsSync(ZKEY);

const RECIPIENT = "GCMPINZMMQVQ7MWIJLB34F5JRAHLQQTWCP6XB5HEZR353PPPWRUWHLPU";
const SCOPE = 1;

describe.skipIf(!HAVE_ARTIFACTS)("pool withdrawal prover (real artifacts)", () => {
  it("generates a v3 withdrawal proof for a single-leaf pool", async () => {
    const value = 1_000_000n;
    const leafIndex = 0;
    const secrets = newNoteSecrets();
    const { commitment } = await deriveDeposit({
      value,
      scope: SCOPE,
      leafIndex,
      nullifier: BigInt(secrets.nullifier),
      secret: BigInt(secrets.secret),
    });

    const note: PoolNote = {
      cluster: "testnet",
      value: value.toString(),
      scope: SCOPE,
      leafIndex,
      nullifier: secrets.nullifier,
      secret: secrets.secret,
      commitment: toHex32(commitment),
      spent: false,
      createdAt: 0,
    };

    const bundle = await provePoolWithdraw({
      note,
      recipient: RECIPIENT,
      relayer: RECIPIENT,
      fee: 0n,
      scope: SCOPE,
      stateLeaves: [commitment],
      depositIndices: [leafIndex],
      artifacts: fileArtifactResolver({ baseDir: PUBLIC_DIR }),
    });

    expect(bundle.proofA.length).toBe(64);
    expect(bundle.proofB.length).toBe(128);
    expect(bundle.proofC.length).toBe(64);
    expect(bundle.stateRoot.length).toBe(32);
    expect(bundle.aspRoot.length).toBe(32);
    expect(bundle.nullifierHash.length).toBe(32);
    expect(bundle.newCommitment.length).toBe(32);
    expect(bundle.withdrawnValue).toBe(value);
  }, 180_000);
});
