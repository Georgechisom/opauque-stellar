import { describe, expect, it } from "vitest";
import { buildProof, buildRoot, getPoseidon, hashFields, MerkleTree } from "../src/merkle.ts";
import { bigintToHex32 } from "../src/bytes.ts";
import { computeDatasetHash } from "../src/publish.ts";
import { runPublisherTick, createMetrics } from "../src/engine.ts";
import { MemoryStore } from "../src/store.ts";
import { buildTreeSnapshot, verifySnapshot, computeSnapshotHash } from "../src/snapshot.ts";
import { formatPrometheusMetrics } from "../src/metrics.ts";
import type { ChainAdapter, LeafCommitment } from "../src/types.ts";

const CANON_1_2 =
  7853200120776062878684798364095072458815029376092732009249414926327459813530n;

class FakeAdapter implements ChainAdapter {
  root: string | null = null;
  posts: Array<{ root: string; datasetHash: string }> = [];

  async currentRoot(): Promise<string | null> {
    return this.root;
  }

  async postRoot(root: string, datasetHash: string): Promise<{ hash: string; ledger: number }> {
    this.root = root;
    this.posts.push({ root, datasetHash });
    return { hash: `tx-${this.posts.length}`, ledger: 100 + this.posts.length };
  }
}

function commitment(id: string, leaf: bigint, ledger = 1): LeafCommitment {
  return {
    id,
    leaf: bigintToHex32(leaf),
    ledger,
    submittedAt: "2026-06-16T00:00:00Z",
  };
}

function recomputeRoot(poseidon: any, leaf: bigint, pathElements: string[], pathIndices: number[]): bigint {
  let cur = leaf;
  for (let i = 0; i < pathElements.length; i += 1) {
    const sibling = BigInt(pathElements[i]);
    cur = pathIndices[i] === 0
      ? hashFields(poseidon, [cur, sibling])
      : hashFields(poseidon, [sibling, cur]);
  }
  return cur;
}

describe("reputation publisher merkle tree", () => {
  it("uses the canonical circomlib Poseidon vector", async () => {
    const p = await getPoseidon();
    expect(hashFields(p, [1n, 2n])).toBe(CANON_1_2);
  });

  it("builds deterministic roots from ordered leaf commitments", async () => {
    const leaves = [bigintToHex32(1n), bigintToHex32(2n)];
    expect(await buildRoot(leaves)).toBe(await buildRoot(leaves));
    expect(await buildRoot(leaves)).not.toBe(await buildRoot([...leaves].reverse()));
  });

  it("matches direct MerkleTree insertion", async () => {
    const p = await getPoseidon();
    const tree = new MerkleTree(p);
    tree.insert(5n);
    tree.insert(6n);
    expect(await buildRoot([bigintToHex32(5n), bigintToHex32(6n)])).toBe(tree.rootHex());
  });

  it("returns inclusion paths that recompute to the root", async () => {
    const p = await getPoseidon();
    const leaves = [bigintToHex32(5n), bigintToHex32(6n), bigintToHex32(7n)];
    const proof = await buildProof(leaves, bigintToHex32(6n));
    expect(proof.leafIndex).toBe(1);
    expect(bigintToHex32(recomputeRoot(p, 6n, proof.pathElements, proof.pathIndices))).toBe(proof.root);
  });
});

describe("dataset hash", () => {
  it("binds root, count, and leaf order", () => {
    const root = bigintToHex32(9n);
    const a = [bigintToHex32(1n), bigintToHex32(2n)];
    const b = [bigintToHex32(2n), bigintToHex32(1n)];
    expect(computeDatasetHash(root, a)).toBe(computeDatasetHash(root, a));
    expect(computeDatasetHash(root, a)).not.toBe(computeDatasetHash(root, b));
  });
});

describe("publisher engine", () => {
  it("accepts leaves, publishes once, and is idempotent", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    store.inbox = [commitment("a", 1n), commitment("b", 2n)];

    const base = {
      verifierId: "CVERIFIER",
      adapter,
      store,
      now: () => "2026-06-16T00:00:00Z",
    };

    const first = await runPublisherTick(base);
    expect(first.leafCount).toBe(2);
    expect(first.newlyAccepted).toBe(2);
    expect(first.published).toBe(true);
    expect(first.latencyMs).toBeGreaterThanOrEqual(0);
    expect(adapter.posts.length).toBe(1);
    expect(store.archived).toEqual(["a", "b"]);

    const second = await runPublisherTick(base);
    expect(second.newlyAccepted).toBe(0);
    expect(second.published).toBe(false);
    expect(adapter.posts.length).toBe(1);
  });

  it("deduplicates by id and leaf", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    store.inbox = [commitment("a", 1n), commitment("a", 3n), commitment("c", 1n)];

    const res = await runPublisherTick({
      verifierId: "CVERIFIER",
      adapter,
      store,
    });

    expect(res.leafCount).toBe(1);
    expect(res.newlyAccepted).toBe(1);
    expect(store.archived).toEqual(["a", "a", "c"]);
  });

  it("self-heals when the on-chain root disappears", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    store.inbox = [commitment("a", 1n)];
    const base = { verifierId: "CVERIFIER", adapter, store };

    await runPublisherTick(base);
    adapter.root = null;
    const healed = await runPublisherTick(base);

    expect(healed.published).toBe(true);
    expect(adapter.posts.length).toBe(2);
  });

  it("tracks metrics across ticks", async () => {
    const adapter = new FakeAdapter();
    const store = new MemoryStore();
    store.inbox = [commitment("a", 1n)];
    const metrics = createMetrics();

    await runPublisherTick({ verifierId: "CVERIFIER", adapter, store }, metrics);
    expect(metrics.totalPublished).toBe(1);
    expect(metrics.lastPublishAt).toBe("2026-06-16T00:00:00Z");
    expect(metrics.currentLeafCount).toBe(1);
  });
});

describe("backpressure", () => {
  it("rejects writes when inbox is full", () => {
    const store = new MemoryStore(2);
    expect(store.writeInbox(commitment("a", 1n))).toBe(true);
    expect(store.writeInbox(commitment("b", 2n))).toBe(true);
    expect(store.writeInbox(commitment("c", 3n))).toBe(false);
    expect(store.inboxSize()).toBe(2);
  });

  it("accepts writes after archive frees space", () => {
    const store = new MemoryStore(2);
    store.writeInbox(commitment("a", 1n));
    store.writeInbox(commitment("b", 2n));
    store.archiveInbox(["a"]);
    expect(store.inboxSize()).toBe(1);
    expect(store.writeInbox(commitment("c", 3n))).toBe(true);
  });
});

describe("snapshot export", () => {
  it("builds a valid snapshot with intermediate hashes", async () => {
    const leaves = [bigintToHex32(5n), bigintToHex32(6n), bigintToHex32(7n)];
    const snapshot = await buildTreeSnapshot("CVERIFIER", leaves);

    expect(snapshot.version).toBe(1);
    expect(snapshot.verifierId).toBe("CVERIFIER");
    expect(snapshot.leafCount).toBe(3);
    expect(snapshot.leaves).toHaveLength(3);
    expect(Object.keys(snapshot.intermediateHashes).length).toBeGreaterThan(0);
    expect(verifySnapshot(snapshot)).toBe(true);
  });

  it("produces a deterministic snapshot hash", async () => {
    const leaves = [bigintToHex32(5n), bigintToHex32(6n)];
    const a = await buildTreeSnapshot("CVERIFIER", leaves);
    const b = await buildTreeSnapshot("CVERIFIER", leaves);
    expect(computeSnapshotHash(a)).toBe(computeSnapshotHash(b));
  });
});

describe("metrics", () => {
  it("formats prometheus metrics", () => {
    const m = createMetrics();
    m.totalSubmitted = 10;
    m.totalAccepted = 8;
    m.totalRejected = 2;
    m.totalPublished = 3;
    m.currentInboxDepth = 5;
    m.currentLeafCount = 100;
    m.lastPublishLatencyMs = 42;

    const output = formatPrometheusMetrics(m);
    expect(output).toContain("publisher_total_submitted 10");
    expect(output).toContain("publisher_total_accepted 8");
    expect(output).toContain("publisher_total_rejected 2");
    expect(output).toContain("publisher_total_published 3");
    expect(output).toContain("publisher_inbox_depth 5");
    expect(output).toContain("publisher_leaf_count 100");
    expect(output).toContain("publisher_last_publish_latency_ms 42");
    expect(output).toContain("publisher_uptime_seconds");
  });
});
