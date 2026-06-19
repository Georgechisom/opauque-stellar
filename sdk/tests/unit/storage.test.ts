import { describe, it, expect } from "vitest";
import {
  MemoryNoteStore,
  MemoryVaultStore,
  MemoryScanStore,
  urlArtifactResolver,
  ArtifactError,
  type PoolNote,
} from "../../src/index";

const note = (commitment: string): PoolNote => ({
  cluster: "testnet",
  value: "5000000",
  scope: 1,
  leafIndex: 0,
  nullifier: "1",
  secret: "2",
  commitment,
  spent: false,
  createdAt: 0,
});

describe("in-memory stores", () => {
  it("adds, lists, and marks notes spent by commitment", async () => {
    const store = new MemoryNoteStore();
    await store.add(note("0xaa"));
    await store.add(note("0xbb"));
    expect((await store.list()).length).toBe(2);

    await store.markSpent("0xaa");
    const spent = (await store.list()).find((n) => n.commitment === "0xaa");
    expect(spent?.spent).toBe(true);
  });

  it("persists and lists ghost entries by stealth address", async () => {
    const vault = new MemoryVaultStore();
    await vault.saveGhost({ cluster: "testnet", stealthAddress: "0x1", createdAt: 1 });
    await vault.saveGhost({ cluster: "testnet", stealthAddress: "0x1", createdAt: 2 });
    const all = await vault.listGhosts();
    expect(all.length).toBe(1); // keyed by stealth address
    expect(all[0].createdAt).toBe(2);
  });

  it("tracks a scan cursor", async () => {
    const scan = new MemoryScanStore();
    expect(await scan.getCursor()).toBeNull();
    await scan.setCursor(3_101_000);
    expect(await scan.getCursor()).toBe(3_101_000);
  });
});

describe("url artifact resolver", () => {
  it("resolves default circuit paths under a base url", async () => {
    const r = urlArtifactResolver({ baseUrl: "https://cdn.example.com/" });
    expect(await r.resolve("reputation-v2", "wasm")).toBe(
      "https://cdn.example.com/circuits/v2/stealth_reputation.wasm",
    );
    expect(await r.resolve("pool-v3", "zkey")).toBe(
      "https://cdn.example.com/circuits/v3/privacy_pool_withdraw_final.zkey",
    );
  });

  it("honors path overrides", async () => {
    const r = urlArtifactResolver({
      baseUrl: "https://x.test",
      paths: { "reputation-v2": { zkey: "custom/rep.zkey" } },
    });
    expect(await r.resolve("reputation-v2", "zkey")).toBe("https://x.test/custom/rep.zkey");
  });

  it("throws ArtifactError for an unknown path", async () => {
    const r = urlArtifactResolver({ baseUrl: "https://x.test" });
    // @ts-expect-error invalid artifact id
    await expect(r.resolve("nope", "wasm")).rejects.toBeInstanceOf(ArtifactError);
  });
});
