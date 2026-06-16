import { describe, expect, it } from "vitest";
import {
  isReputationRootUnavailableError,
  REPUTATION_ROOT_UNAVAILABLE_MESSAGE,
} from "../reputationProver";

describe("reputationProver", () => {
  it("recognizes get_latest_root Contract #2 as an unavailable root", () => {
    const err = new Error(
      "HostError: Error(Contract, #2) Event log (newest first): " +
        "topics:[fn_call, CAFVXL6A5N4FVQZ733GLUX27ETPLLINLE75ZABNLFYEKPIYZORFCBSVR, get_latest_root]",
    );

    expect(isReputationRootUnavailableError(err)).toBe(true);
    expect(REPUTATION_ROOT_UNAVAILABLE_MESSAGE).toContain("root publisher/indexer");
  });

  it("does not classify unrelated contract errors as root availability errors", () => {
    expect(isReputationRootUnavailableError("HostError: Error(Contract, #2) verify_reputation")).toBe(false);
    expect(isReputationRootUnavailableError("network timeout")).toBe(false);
  });
});
