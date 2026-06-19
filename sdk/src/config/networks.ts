/**
 * Stellar network presets: passphrase and default RPC / Horizon endpoints per
 * network. Mainnet ships with no default endpoints — callers must supply
 * production providers explicitly.
 */

export type OpaqueNetwork = "testnet" | "mainnet" | "futurenet" | "local";

export const OPAQUE_NETWORKS: readonly OpaqueNetwork[] = [
  "testnet",
  "futurenet",
  "mainnet",
  "local",
];

export interface NetworkPreset {
  passphrase: string;
  rpcUrls: string[];
  horizonUrls: string[];
}

export const NETWORK_PRESETS: Record<OpaqueNetwork, NetworkPreset> = {
  testnet: {
    passphrase: "Test SDF Network ; September 2015",
    rpcUrls: ["https://soroban-testnet.stellar.org"],
    horizonUrls: ["https://horizon-testnet.stellar.org"],
  },
  futurenet: {
    passphrase: "Test SDF Future Network ; October 2022",
    rpcUrls: ["https://rpc-futurenet.stellar.org"],
    horizonUrls: ["https://horizon-futurenet.stellar.org"],
  },
  mainnet: {
    passphrase: "Public Global Stellar Network ; September 2015",
    // No defaults: mainnet requires explicit production providers.
    rpcUrls: [],
    horizonUrls: [],
  },
  local: {
    passphrase: "Standalone Network ; February 2017",
    rpcUrls: ["http://localhost:8000/soroban/rpc"],
    horizonUrls: ["http://localhost:8000"],
  },
};
