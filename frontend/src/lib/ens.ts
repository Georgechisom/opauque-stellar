/**
 * Domain name resolution: placeholder for federation / .sol-style identifiers.
 */

/**
 * Check if an identifier looks like a domain name (ends with .sol).
 */
export function isDomainName(input: string): boolean {
  return input.trim().toLowerCase().endsWith(".sol");
}

/**
 * Resolve a domain name to a Stellar address (not implemented).
 */
export async function resolveDomain(_domain: string): Promise<string | null> {
  return null;
}

/** @deprecated use isDomainName */
export const isEnsName = isDomainName;

/** @deprecated use resolveDomain */
export const resolveEnsToAddress = resolveDomain;
