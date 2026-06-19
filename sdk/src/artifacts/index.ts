/**
 * Circuit artifact resolution. Groth16 proving needs a circuit `.wasm` and a
 * proving-key `.zkey`. Large `.zkey` files are never bundled into the package:
 * an {@link ArtifactResolver} fetches them (and, in integrity-checking
 * implementations, verifies their hash) at proof time.
 *
 * The default {@link urlArtifactResolver} returns URLs suitable for snarkjs in a
 * browser or any fetch-capable runtime. A filesystem-caching resolver for Node
 * lives in the `./node` entry (it needs `fs`).
 */
import { ArtifactError } from "../errors/index";

export type ArtifactId = "reputation-v2" | "pool-v3";
export type ArtifactKind = "wasm" | "zkey";

export interface ArtifactResolver {
  /** Resolve an artifact to a URL string or its raw bytes. */
  resolve(id: ArtifactId, kind: ArtifactKind): Promise<string | Uint8Array>;
}

/** Default relative paths, matching the published circuit release layout. */
export const DEFAULT_ARTIFACT_PATHS: Record<
  ArtifactId,
  Record<ArtifactKind, string>
> = {
  "reputation-v2": {
    wasm: "circuits/v2/stealth_reputation.wasm",
    zkey: "circuits/v2/stealth_reputation_final.zkey",
  },
  "pool-v3": {
    wasm: "circuits/v3/privacy_pool_withdraw.wasm",
    zkey: "circuits/v3/privacy_pool_withdraw_final.zkey",
  },
};

/**
 * Build a resolver that maps artifacts to URLs under a base URL. Pass `paths` to
 * override individual artifact locations.
 */
export function urlArtifactResolver(opts: {
  baseUrl: string;
  paths?: Partial<Record<ArtifactId, Partial<Record<ArtifactKind, string>>>>;
}): ArtifactResolver {
  const base = opts.baseUrl.replace(/\/+$/, "");
  return {
    async resolve(id, kind) {
      const path = opts.paths?.[id]?.[kind] ?? DEFAULT_ARTIFACT_PATHS[id]?.[kind];
      if (!path) {
        throw new ArtifactError(`No artifact path for ${id}/${kind}`);
      }
      return `${base}/${path.replace(/^\/+/, "")}`;
    },
  };
}

/**
 * Build a resolver that maps artifacts to local filesystem paths under a base
 * directory. The returned path strings are consumed directly by snarkjs in Node.
 */
export function fileArtifactResolver(opts: {
  baseDir: string;
  paths?: Partial<Record<ArtifactId, Partial<Record<ArtifactKind, string>>>>;
}): ArtifactResolver {
  const base = opts.baseDir.replace(/\/+$/, "");
  return {
    async resolve(id, kind) {
      const path = opts.paths?.[id]?.[kind] ?? DEFAULT_ARTIFACT_PATHS[id]?.[kind];
      if (!path) {
        throw new ArtifactError(`No artifact path for ${id}/${kind}`);
      }
      return `${base}/${path.replace(/^\/+/, "")}`;
    },
  };
}
