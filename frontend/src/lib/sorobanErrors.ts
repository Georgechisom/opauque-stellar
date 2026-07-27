/**
 * Soroban contract error decoding and user-readable error messages.
 */

import { rpc } from "@stellar/stellar-sdk";

export type SimulationResult = {
  success: boolean;
  estimatedFee?: string;
  error?: string;
  errorCode?: string;
};

/**
 * Common Soroban error codes and their user-friendly messages.
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Contract errors
  "Contract#1": "Insufficient balance",
  "Contract#2": "Unauthorized access",
  "Contract#3": "Invalid input",
  "Contract#4": "Operation not allowed",
  "Contract#5": "Resource not found",
  "Contract#6": "Already exists",
  "Contract#7": "Expired",
  "Contract#8": "Invalid signature",

  // Host errors
  HostError: "Contract execution failed",
  InvokeHostFunctionTrapped: "Contract execution trapped",
  InvokeHostFunctionResourceLimitExceeded: "Resource limit exceeded",
  InvokeHostFunctionInsufficientRefundableFee: "Insufficient fee",

  // Budget errors
  ExceededLimit: "Transaction exceeded resource limits",
  InsufficientBudget: "Insufficient computational budget",

  // Storage errors
  StorageError: "Contract storage error",
  MissingValue: "Required value not found in storage",

  // Auth errors
  InvalidAction: "Invalid authorization action",
  MissingAuth: "Missing required authorization",
};

/**
 * Extract the stable machine-readable token from a simulation error, e.g.
 * `Contract#5` or `HostError`. Returned alongside the human message so callers
 * can branch on the code instead of the copy (#562).
 */
export function extractErrorCode(
  sim: rpc.Api.SimulateTransactionResponse,
): string | null {
  const errorStr =
    "error" in sim && sim.error
      ? sim.error
      : ((sim as { results?: Array<{ error?: string }> }).results?.[0]?.error ??
        "");
  if (!errorStr) return null;
  const contractErrorMatch = errorStr.match(/Contract#(\d+)/);
  if (contractErrorMatch) return `Contract#${contractErrorMatch[1]}`;
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (errorStr.includes(code)) return code;
  }
  return null;
}

/**
 * Decode Soroban simulation error into user-readable message.
 */
export function decodeSimulationError(
  sim: rpc.Api.SimulateTransactionResponse,
): string {
  if ("error" in sim && sim.error) {
    const errorStr = sim.error;

    // Check for known error patterns
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      if (errorStr.includes(code)) {
        return message;
      }
    }

    // Extract contract error code if present
    const contractErrorMatch = errorStr.match(/Contract#(\d+)/);
    if (contractErrorMatch) {
      return `Contract error #${contractErrorMatch[1]}`;
    }

    // Return cleaned error message
    return errorStr.replace(/^Error: /, "").slice(0, 200);
  }

  const legacyResults = (sim as { results?: Array<{ error?: string }> }).results;
  if (legacyResults && legacyResults.length > 0) {
    const result = legacyResults[0];
    if (result && result.error) {
      return decodeResultError(result.error);
    }
  }

  return "Transaction simulation failed";
}

/**
 * Decode individual result error.
 */
function decodeResultError(error: string): string {
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (error.includes(code)) {
      return message;
    }
  }
  return error.slice(0, 200);
}

/**
 * Extract estimated fee from simulation.
 */
export function extractEstimatedFee(
  sim: rpc.Api.SimulateTransactionSuccessResponse,
): string {
  if ("minResourceFee" in sim && sim.minResourceFee) {
    const fee = BigInt(sim.minResourceFee);
    return (Number(fee) / 1e7).toFixed(7);
  }
  return "0";
}

/**
 * Check if simulation was successful.
 */
export function isSimulationSuccess(
  sim: rpc.Api.SimulateTransactionResponse,
): sim is rpc.Api.SimulateTransactionSuccessResponse {
  // Use the SDK's own guard. The previous check required `results` (plural), the
  // RAW RPC shape, but the parsed v15 success response exposes `result` (singular),
  // so the old check misclassified every successful simulation as a failure.
  return !rpc.Api.isSimulationError(sim);
}

/**
 * Simulate transaction and return user-friendly result.
 */
export async function simulateAndDecode(
  server: rpc.Server,
  tx: Parameters<rpc.Server["simulateTransaction"]>[0],
): Promise<SimulationResult> {
  try {
    const sim = await server.simulateTransaction(tx);

    if (isSimulationSuccess(sim)) {
      return {
        success: true,
        estimatedFee: extractEstimatedFee(sim),
      };
    }

    return {
      success: false,
      error: decodeSimulationError(sim),
      errorCode: extractErrorCode(sim) ?? undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Simulation failed",
    };
  }
}
