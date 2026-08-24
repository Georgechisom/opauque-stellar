/**
 * RPC endpoint hostname allowlist for production builds.
 *
 * Validates that configured RPC endpoints use whitelisted hostnames
 * to prevent misconfiguration from pointing the wallet at attacker-controlled RPC.
 */

export type StellarNetwork = "testnet" | "futurenet" | "mainnet" | "local";

const ALLOWED_HOSTNAMES: Record<StellarNetwork, Set<string>> = {
  testnet: new Set([
    "soroban-testnet.stellar.org",
    "horizon-testnet.stellar.org",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ]),
  futurenet: new Set([
    "rpc-futurenet.stellar.org",
    "horizon-futurenet.stellar.org",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ]),
  mainnet: new Set([
    "mainnet.sorobanrpc.com",
    "horizon.stellar.org",
  ]),
  local: new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ]),
};

/**
 * Checks if a hostname is allowed for the given network.
 * In dev mode (VITE_ENV not set to 'production'), allows localhost.
 * In production, only allows whitelisted hostnames.
 */
export function isHostnameAllowed(hostname: string, network: StellarNetwork, isProduction: boolean): boolean {
  // Normalize hostname (lowercase, remove port)
  const normalizedHost = hostname.toLowerCase().split(":")[0];

  // Dev mode always allows localhost
  if (!isProduction) {
    if (normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "0.0.0.0") {
      return true;
    }
  }

  const allowlist = ALLOWED_HOSTNAMES[network];
  return allowlist.has(normalizedHost);
}

/**
 * Validates an RPC URL hostname against the allowlist.
 * Throws an error if the hostname is not allowed for the network.
 */
export function validateRpcHostname(url: string, network: StellarNetwork, isProduction: boolean): void {
  try {
    const parsedUrl = new URL(url);
    if (!isHostnameAllowed(parsedUrl.hostname, network, isProduction)) {
      throw new Error(
        `RPC hostname "${parsedUrl.hostname}" is not in the allowlist for ${network}. ` +
        `Allowed hostnames: ${Array.from(ALLOWED_HOSTNAMES[network] || []).join(", ")}`
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid RPC URL: ${url}`);
    }
    throw error;
  }
}

/**
 * Returns a human-readable string of allowed hostnames for a network.
 */
export function getAllowedHostnames(network: StellarNetwork): string {
  return Array.from(ALLOWED_HOSTNAMES[network] || []).sort().join(", ");
}
