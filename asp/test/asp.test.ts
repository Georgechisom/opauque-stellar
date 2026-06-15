import { describe, expect, it } from "vitest";
import { getPoseidon, hashFields, MerkleTree, computeLabel } from "../src/merkle.ts";
import { AssociationSet } from "../src/set.ts";
import { approveAll, allowlist } from "../src/policy.ts";
import { MemoryStore } from "../src/store.ts";
import { computeDatasetHash } from "../src/publish.ts";
import { runPoolTick } from "../src/engine.ts";
import type { ChainAdapter, Deposit, StateTreeSnapshot } from "../src/types.ts";

const CANON_1_2 =
  7853200120776062878684798364095072458815029376092732009249414926327459813530n;

function recomputeRoot(poseidon: any, leaf: bigint, pathElements: bigint[], pathIndices: number[]): bigint {
  let cur = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    cur =
      pathIndices[i] === 0
        ? hashFields(poseidon, [cur, pathElements[i]])
        : hashFields(poseidon, [pathElements[i], cur]);
  }
  return cur;
}

describe("merkle", () => {
  it("uses circomlib Poseidon (matches the contract/circuit vector)", async () => {
    const p = await getPoseidon();
    expect(hashFields(p, [1n, 2n])).toBe(CANON_1_2);
  });

  it("inclusion proofs verify against the root", async () => {
    const p = await getPoseidon();
    const tree = new MerkleTree(p);
    for (let i = 0; i < 5; i++) tree.insert(computeLabel(p, 1, i));
    for (let i = 0; i < 5; i++) {
      const { pathElements, pathIndices, root } = tree.proof(i);
      expect(recomputeRoot(p, computeLabel(p, 1, i), pathElements, pathIndices)).toBe(root);
    }
  });
});

describe("association set", () => {
  it("grows and yields verifying proofs; root is deterministic", async () => {
    const a = await AssociationSet.create(1);
    const b = await AssociationSet.create(1);
    for (const set of [a, b]) {
      set.add(0);
      set.add(1);
      set.add(2);
    }
    expect(a.rootHex()).toBe(b.rootHex()); // deterministic
    expect(a.size).toBe(3);

    const p = await getPoseidon();
    const { pathElements, pathIndices, root } = a.proof(1);
    expect("0x" + root.toString(16).padStart(64, "0")).toBe(a.rootHex());
    expect(recomputeRoot(p, computeLabel(p, 1, 1), pathElements, pathIndices)).toBe(root);
  });

  it("scope changes the root", async () => {
    const a = await AssociationSet.create(1);
    const b = await AssociationSet.create(2);
    a.add(0);
    b.add(0);
    expect(a.rootHex()).not.toBe(b.rootHex());
  });
});

describe("policy", () => {
  const dep = (index: number): Deposit => ({
    index,
    commitment: "0x00",
    value: "1",
    scope: 1,
    ledger: 1,
  });
  it("approveAll approves everything", async () => {
    expect(await approveAll.screen(dep(0))).toBe("approve");
  });
  it("allowlist approves listed, defers others", async () => {
    const pol = allowlist([1, 3]);
    expect(await pol.screen(dep(1))).toBe("approve");
    expect(await pol.screen(dep(2))).toBe("defer");
  });
});

describe("store", () => {
  it("round-trips state", () => {
    const s = new MemoryStore();
    expect(s.load("p")).toBeNull();
    s.save({ poolId: "p", scope: 1, approvedIndices: [0, 2], lastIndex: 2, lastLedger: 9 });
    expect(s.load("p")?.approvedIndices).toEqual([0, 2]);
  });
});

describe("dataset hash", () => {
  it("is deterministic and order-sensitive", () => {
    expect(computeDatasetHash(["1", "2"])).toBe(computeDatasetHash(["1", "2"]));
    expect(computeDatasetHash(["1", "2"])).not.toBe(computeDatasetHash(["2", "1"]));
  });
});

// In-memory chain adapter for engine tests (no network).
class FakeAdapter implements ChainAdapter {
  deposits: Deposit[] = [];
  root: string | null = null;
  posts: Array<{ root: string; datasetHash: string }> = [];
  stateLeaves: string[] = [];
  stateRoot: string | null = null;
  statePosts: Array<{ root: string; datasetHash: string }> = [];
  async readDeposits(afterIndex: number): Promise<Deposit[]> {
    return this.deposits.filter((d) => d.index > afterIndex);
  }
  async currentAspRoot() {
    return this.root;
  }
  async postAspRoot(root: string, datasetHash: string) {
    this.root = root;
    this.posts.push({ root, datasetHash });
  }
  async readStateLeaves(): Promise<StateTreeSnapshot> {
    return {
      leaves: [...this.stateLeaves],
      eventCount: this.stateLeaves.length,
      maxIndex: this.stateLeaves.length - 1,
    };
  }
  async currentStateRoot() {
    return this.stateRoot;
  }
  async postStateRoot(root: string, datasetHash: string) {
    this.stateRoot = root;
    this.statePosts.push({ root, datasetHash });
  }
  async latestLedger() {
    return 100;
  }
}

function deposit(index: number): Deposit {
  return { index, commitment: `0x${index}`, value: "1000", scope: 1, ledger: 10 + index };
}

describe("engine reconcile", () => {
  it("approves, publishes once, is idempotent, and republishes on new deposits", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    const base = {
      poolId: "pool",
      scope: 1,
      adapter,
      store,
      policy: approveAll,
      now: () => "2026-06-15T00:00:00.000Z",
    };

    adapter.deposits = [deposit(0), deposit(1)];
    const r1 = await runPoolTick(base);
    expect(r1.approvedCount).toBe(2);
    expect(r1.published).toBe(true);
    expect(adapter.posts.length).toBe(1);
    expect(adapter.root).toBe(r1.localRoot);

    // No new deposits → on-chain root matches → no republish (idempotent).
    const r2 = await runPoolTick(base);
    expect(r2.published).toBe(false);
    expect(adapter.posts.length).toBe(1);

    // New deposit → root changes → republish.
    adapter.deposits.push(deposit(2));
    const r3 = await runPoolTick(base);
    expect(r3.approvedCount).toBe(3);
    expect(r3.published).toBe(true);
    expect(adapter.posts.length).toBe(2);
  });

  it("self-heals when the on-chain root drifts (crash-after-compute)", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    adapter.deposits = [deposit(0)];
    const base = { poolId: "pool", scope: 1, adapter, store, policy: approveAll };

    await runPoolTick(base);
    expect(adapter.posts.length).toBe(1);
    // Simulate the on-chain root being lost/stale; next tick re-detects + republishes.
    adapter.root = null;
    const r = await runPoolTick(base);
    expect(r.published).toBe(true);
    expect(adapter.posts.length).toBe(2);
  });

  it("publishes state roots reconstructed from pool leaves", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    adapter.stateLeaves = [
      `0x${"01".padStart(64, "0")}`,
      `0x${"02".padStart(64, "0")}`,
    ];

    const r1 = await runPoolTick({
      poolId: "pool",
      scope: 1,
      adapter,
      store,
      policy: approveAll,
    });
    expect(r1.stateLeafCount).toBe(2);
    expect(r1.statePublished).toBe(true);
    expect(adapter.statePosts.length).toBe(1);

    const r2 = await runPoolTick({
      poolId: "pool",
      scope: 1,
      adapter,
      store,
      policy: approveAll,
    });
    expect(r2.statePublished).toBe(false);
    expect(adapter.statePosts.length).toBe(1);
  });
});
