import type { Tab } from "../components/Layout";
import { getFeatureFlags } from "./featureFlags";

export type TabAccess = "full" | "readonly" | "hidden";

export function getTabAccess(tab: Tab): TabAccess {
  const flags = getFeatureFlags();

  switch (tab) {
    case "reputation":
    case "my-traits":
      return flags.reputationProofs ? "full" : "readonly";
    case "schemas":
    case "attest":
      return flags.schemaManagement ? "full" : "hidden";
    case "manage":
      return flags.schemaManagement ? "full" : "readonly";
    case "pool":
      return flags.privacyPool ? "full" : "hidden";
    default:
      return "full";
  }
}

export function isTabNavVisible(tab: Tab): boolean {
  return getTabAccess(tab) !== "hidden";
}
