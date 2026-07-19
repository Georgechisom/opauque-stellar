import { describe, expect, it } from "vitest";
import { getDocUrl, getUserRecoverySectionUrl } from "../docsLinks";

describe("docsLinks", () => {
  it("builds GitHub doc URLs", () => {
    expect(getDocUrl("user-recovery")).toBe(
      "https://github.com/collinsadi/opauque-stellar/blob/main/README.md#recovery",
    );
  });

  it("builds anchored section URLs without a doubled fragment", () => {
    expect(getUserRecoverySectionUrl("manual-ghost")).toBe(
      "https://github.com/collinsadi/opauque-stellar/blob/main/README.md#recovery",
    );
  });
});
