/**
 * Typed error hierarchy for the SDK. Every thrown error carries a stable,
 * machine-readable `code` so callers can branch without string-matching
 * messages. Soroban contract failures map to {@link ContractError} with the
 * decoded contract error code (and a name when the contract's error enum is
 * known to the SDK).
 */

export class OpaqueError extends Error {
  /** Stable, machine-readable error code (e.g. "CONFIG", "CONTRACT"). */
  readonly code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Configuration is missing or invalid (e.g. mainnet without RPC URLs). */
export class ConfigError extends OpaqueError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "CONFIG", options);
  }
}

/** A signer adapter failed to produce a signature. */
export class SignerError extends OpaqueError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "SIGNER", options);
  }
}

/** An RPC or Horizon request failed (network, timeout, or HTTP status). */
export class RpcError extends OpaqueError {
  readonly httpStatus?: number;
  constructor(
    message: string,
    options?: { httpStatus?: number; cause?: unknown },
  ) {
    super(message, "RPC", options);
    this.httpStatus = options?.httpStatus;
  }
}

/** A transaction failed during pre-flight simulation. */
export class SimulationError extends OpaqueError {
  readonly diagnostics?: string;
  constructor(
    message: string,
    options?: { diagnostics?: string; cause?: unknown },
  ) {
    super(message, "SIMULATION", options);
    this.diagnostics = options?.diagnostics;
  }
}

/** A Soroban contract invocation reverted with a contract error code. */
export class ContractError extends OpaqueError {
  readonly contract: string;
  readonly contractCode: number;
  /** Human-readable name when the contract's error enum is known. */
  readonly errorName?: string;
  constructor(opts: {
    contract: string;
    contractCode: number;
    errorName?: string;
    message?: string;
    cause?: unknown;
  }) {
    const label = opts.errorName
      ? `${opts.errorName} (#${opts.contractCode})`
      : `#${opts.contractCode}`;
    super(
      opts.message ?? `${opts.contract} reverted: ${label}`,
      "CONTRACT",
      { cause: opts.cause },
    );
    this.contract = opts.contract;
    this.contractCode = opts.contractCode;
    this.errorName = opts.errorName;
  }
}

/** The published reputation/pool root is unavailable or not yet indexed. */
export class RootUnavailableError extends OpaqueError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "ROOT_UNAVAILABLE", options);
  }
}

/** A circuit artifact failed to resolve or failed its integrity check. */
export class ArtifactError extends OpaqueError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "ARTIFACT", options);
  }
}

/**
 * A capability that depends on a layer not yet wired in this build (e.g. the
 * proving layer, the WASM scanner, or the relayer gateway client). Thrown so the
 * surface is discoverable and the failure is explicit rather than silent.
 */
export class NotWiredError extends OpaqueError {
  constructor(capability: string, hint?: string) {
    super(
      `${capability} is not wired in this build.` + (hint ? ` ${hint}` : ""),
      "NOT_WIRED",
    );
  }
}

/**
 * Known contract error enums, keyed by contract package name. Populated as the
 * SDK binds each contract; an unknown code still surfaces as a numeric
 * {@link ContractError}. Source of truth is each contract's `#[contracterror]`.
 */
export const CONTRACT_ERROR_NAMES: Record<string, Record<number, string>> = {
  "reputation-verifier": {
    2: "RootExpired",
    4: "NullifierReplay",
  },
};

/** Look up a contract error name for a code, if the SDK knows the enum. */
export function contractErrorName(
  contractPackage: string,
  code: number,
): string | undefined {
  return CONTRACT_ERROR_NAMES[contractPackage]?.[code];
}
