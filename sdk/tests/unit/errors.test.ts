import { describe, it, expect } from "vitest";
import {
  OpaqueError,
  ConfigError,
  ContractError,
  RpcError,
  contractErrorName,
} from "../../src/index";

describe("error hierarchy", () => {
  it("carries stable codes and instanceof chains", () => {
    const e = new ConfigError("bad config");
    expect(e).toBeInstanceOf(OpaqueError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("CONFIG");
    expect(e.name).toBe("ConfigError");
  });

  it("contract errors expose contract + code and a derived message", () => {
    const e = new ContractError({
      contract: "reputation-verifier",
      contractCode: 4,
      errorName: contractErrorName("reputation-verifier", 4),
    });
    expect(e.code).toBe("CONTRACT");
    expect(e.contractCode).toBe(4);
    expect(e.errorName).toBe("NullifierReplay");
    expect(e.message).toContain("NullifierReplay");
    expect(e.message).toContain("#4");
  });

  it("preserves the cause and optional fields", () => {
    const cause = new Error("socket hang up");
    const e = new RpcError("rpc failed", { httpStatus: 503, cause });
    expect(e.httpStatus).toBe(503);
    expect((e as { cause?: unknown }).cause).toBe(cause);
  });

  it("returns undefined for unknown contract error codes", () => {
    expect(contractErrorName("reputation-verifier", 999)).toBeUndefined();
    expect(contractErrorName("unknown-contract", 1)).toBeUndefined();
  });
});
