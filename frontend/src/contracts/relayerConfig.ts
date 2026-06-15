import { getActiveManifest } from "./deploymentManifest";

export type RelayerConfig = {
  registryId: string;
  nativeSac: string;
  privacyPool: string;
  gatewayUrls: string[];
  minimumStake: bigint;
  unstakeCooldownLedgers: number;
  maxDeadlineLedgers: number;
};

type RelayerWiring = {
  nativeSac?: string;
  privacyPool?: string;
  minimumStake?: number | string;
  unstakeCooldownLedgers?: number;
  maxDeadlineLedgers?: number;
  gatewayUrls?: string[];
};

export function getRelayerConfig(): RelayerConfig | null {
  const manifest = getActiveManifest() as
    | (ReturnType<typeof getActiveManifest> & {
        contracts?: Record<string, { id?: string | null }>;
        wiring?: { relayerRegistry?: RelayerWiring };
      })
    | null;
  if (!manifest) return null;
  const registryId = manifest.contracts?.relayerRegistry?.id;
  const wiring = manifest.wiring?.relayerRegistry;
  if (!registryId || !wiring?.nativeSac || !wiring.privacyPool) return null;
  return {
    registryId,
    nativeSac: wiring.nativeSac,
    privacyPool: wiring.privacyPool,
    gatewayUrls: Array.isArray(wiring.gatewayUrls)
      ? wiring.gatewayUrls.map((url) => url.trim()).filter(Boolean)
      : [],
    minimumStake: BigInt(wiring.minimumStake ?? 1_000_000),
    unstakeCooldownLedgers: wiring.unstakeCooldownLedgers ?? 720,
    maxDeadlineLedgers: wiring.maxDeadlineLedgers ?? 17_280,
  };
}

export function isRelayerMarketDeployed(): boolean {
  return getRelayerConfig() !== null;
}
