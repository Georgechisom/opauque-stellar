import { buildRoot } from "./merkle.ts";
import { computeDatasetHash, rootManifest, writeRootManifest } from "./publish.ts";
import type { Store } from "./store.ts";
import type { ChainAdapter, LeafCommitment, PublisherState } from "./types.ts";

export interface PublisherTickConfig {
  verifierId: string;
  adapter: ChainAdapter;
  store: Store;
  dataDir?: string;
  now?: () => string;
  minLeavesToPublish?: number;
}

export interface PublisherTickResult {
  verifierId: string;
  leafCount: number;
  newlyAccepted: number;
  localRoot: string | null;
  onChainRoot: string | null;
  datasetHash: string | null;
  published: boolean;
  txHash?: string;
}

function initState(verifierId: string, now: string): PublisherState {
  return {
    verifierId,
    leaves: [],
    lastPublishedRoot: null,
    lastPublishedLedger: null,
    lastDatasetHash: null,
    updatedAt: now,
  };
}

function mergeLeaves(existing: LeafCommitment[], incoming: LeafCommitment[]): {
  leaves: LeafCommitment[];
  acceptedIds: string[];
} {
  const byId = new Map<string, LeafCommitment>();
  const byLeaf = new Set<string>();
  for (const leaf of existing) {
    byId.set(leaf.id, leaf);
    byLeaf.add(leaf.leaf);
  }
  const acceptedIds: string[] = [];
  for (const leaf of incoming) {
    if (byId.has(leaf.id) || byLeaf.has(leaf.leaf)) continue;
    byId.set(leaf.id, leaf);
    byLeaf.add(leaf.leaf);
    acceptedIds.push(leaf.id);
  }
  const leaves = Array.from(byId.values()).sort((a, b) => {
    const aKey = `${String(a.ledger ?? 0).padStart(12, "0")}:${a.id}`;
    const bKey = `${String(b.ledger ?? 0).padStart(12, "0")}:${b.id}`;
    return aKey.localeCompare(bKey);
  });
  return { leaves, acceptedIds };
}

export async function runPublisherTick(cfg: PublisherTickConfig): Promise<PublisherTickResult> {
  const now = cfg.now ?? (() => new Date().toISOString());
  const at = now();
  const state = cfg.store.load(cfg.verifierId) ?? initState(cfg.verifierId, at);
  const inbox = cfg.store.readInbox(now);
  const processedIds = inbox.map((leaf) => leaf.id);
  const { leaves, acceptedIds } = mergeLeaves(state.leaves, inbox);
  state.leaves = leaves;
  state.updatedAt = at;

  const minLeaves = cfg.minLeavesToPublish ?? 1;
  if (leaves.length < minLeaves) {
    cfg.store.archiveInbox(processedIds);
    cfg.store.save(state);
    return {
      verifierId: cfg.verifierId,
      leafCount: leaves.length,
      newlyAccepted: acceptedIds.length,
      localRoot: null,
      onChainRoot: await cfg.adapter.currentRoot(),
      datasetHash: null,
      published: false,
    };
  }

  const leafValues = leaves.map((x) => x.leaf);
  const localRoot = await buildRoot(leafValues);
  const datasetHash = computeDatasetHash(localRoot, leafValues);
  const onChainRoot = await cfg.adapter.currentRoot();

  let published = false;
  let txHash: string | undefined;
  if (localRoot !== onChainRoot) {
    if (cfg.dataDir) {
      writeRootManifest(
        cfg.dataDir,
        rootManifest({
          verifierId: cfg.verifierId,
          root: localRoot,
          datasetHash,
          leaves: leafValues,
          generatedAt: at,
        }),
      );
    }
    const res = await cfg.adapter.postRoot(localRoot, datasetHash);
    published = true;
    txHash = res.hash;
    state.lastPublishedRoot = localRoot;
    state.lastPublishedLedger = res.ledger ?? null;
    state.lastDatasetHash = datasetHash;
  }

  cfg.store.archiveInbox(processedIds);
  cfg.store.save(state);
  return {
    verifierId: cfg.verifierId,
    leafCount: leaves.length,
    newlyAccepted: acceptedIds.length,
    localRoot,
    onChainRoot,
    datasetHash,
    published,
    txHash,
  };
}
