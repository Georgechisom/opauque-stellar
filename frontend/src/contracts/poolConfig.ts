/**
 * Privacy-pool deployment config, read from the bundled deployment manifest
 * (deployments/v1/<network>.json). The pool id + native SAC + scope live under
 * `contracts.privacyPool` / `wiring.privacyPool`, which are outside the strict
 * `ContractKey` set, so they are read here rather than threaded through
 * `resolveAllContractIds`. Returns null when the pool isn't deployed on the active
 * network (the Pool tab then degrades to a "not available" notice).
 */
import { getActiveManifest } from "./deploymentManifest";

export type PoolConfig = {
  poolId: string;
  /** Native XLM Stellar Asset Contract id. */
  nativeSac: string;
  /** Label domain separator (Poseidon(scope, depositIndex)). */
  scope: number;
};

type PoolWiring = {
  groth16Verifier?: string;
  nativeSac?: string;
  scope?: number;
};

export function getPoolConfig(): PoolConfig | null {
  const manifest = getActiveManifest() as
    | (ReturnType<typeof getActiveManifest> & {
        contracts?: Record<string, { id?: string }>;
        wiring?: { privacyPool?: PoolWiring };
      })
    | null;
  if (!manifest) return null;

  const poolId = manifest.contracts?.privacyPool?.id;
  const wiring = manifest.wiring?.privacyPool;
  if (!poolId || !wiring?.nativeSac) return null;

  return { poolId, nativeSac: wiring.nativeSac, scope: wiring.scope ?? 1 };
}

export function isPoolDeployed(): boolean {
  return getPoolConfig() !== null;
}
