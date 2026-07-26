import { isAllowed, getNetworkDetails } from "@stellar/freighter-api";
import { useSecurityStore } from "../store/securityStore";
import { networkConnectivityService } from "./networkConnectivity";

export class NetworkValidationService {
  /**
   * Returns the current Freighter network (lowercased), or "unknown" if the wallet
   * isn't connected/authorized yet.
   *
   * Passive read only, it must NOT call setAllowed()/requestAccess(). This runs on
   * background checks (e.g. the network-mismatch watcher), and prompting for access on
   * a timer made Freighter pop up repeatedly on the onboarding screen. Access is
   * requested explicitly via the connect button (see StellarWalletProviders).
   */
  static async getWalletNetwork(): Promise<string> {
    try {
      const allowed = await isAllowed();
      if (!allowed.isAllowed) return "unknown";
      const details = await getNetworkDetails();
      if (details.error || !details.network) return "unknown";
      return details.network.toLowerCase();
    } catch (e) {
      console.error("Error getting network details from Freighter:", e);
      return "unknown";
    }
  }

  /**
   * Verifies if the wallet network matches the application's configured expected network.
   */
  static async validateWalletContext(): Promise<{ valid: boolean; expected: string; actual: string }> {
    const expected = useSecurityStore.getState().expectedNetwork;
    const actual = await this.getWalletNetwork();
    
    // Some normalization for local networks
    const isLocalMatch = expected === "local" && (actual.includes("local") || actual.includes("standalone"));
    
    // Testnet can sometimes be TESTNET or testnet, same for others.
    const isExactMatch = actual.includes(expected);

    return {
      valid: isExactMatch || isLocalMatch,
      expected,
      actual
    };
  }

  /**
   * Throws an error if the network mismatch occurs. Used before signing.
   */
  static async requireValidNetwork() {
    const validation = await this.validateWalletContext();
    if (!validation.valid) {
      throw new Error(`Network mismatch detected. Expected: ${validation.expected}, Wallet: ${validation.actual}`);
    }
  }
}
