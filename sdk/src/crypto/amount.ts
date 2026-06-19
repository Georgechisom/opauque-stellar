/**
 * String-based decimal parsing for XLM amounts to avoid floating-point precision
 * issues. XLM uses 7 decimal places (1 XLM = 10^7 stroops).
 */

const MAX_DECIMALS = 7;

/**
 * Parse an XLM string into stroops. Enforces at most 7 decimal places and
 * rejects malformed input.
 *
 * @throws if the input is empty, non-numeric, or has more than 7 decimals.
 */
export function parseXlmToStroops(xlmString: string): bigint {
  const trimmed = xlmString.trim();
  if (!trimmed) {
    throw new Error("XLM amount cannot be empty");
  }
  if (!/^-?\d+\.?\d*$/.test(trimmed)) {
    throw new Error(`Invalid XLM amount: ${trimmed}`);
  }

  const isNegative = trimmed.startsWith("-");
  const absolute = isNegative ? trimmed.slice(1) : trimmed;

  const parts = absolute.split(".");
  const integerPart = parts[0] || "0";
  const decimalPart = parts[1] || "";

  if (decimalPart.length > MAX_DECIMALS) {
    throw new Error(
      `XLM amount has too many decimal places (max ${MAX_DECIMALS}): ${trimmed}`,
    );
  }

  const paddedDecimal = decimalPart.padEnd(MAX_DECIMALS, "0");
  const stroops = BigInt(integerPart + paddedDecimal);
  return isNegative ? -stroops : stroops;
}

/**
 * Parse a Horizon balance string into stroops. Returns 0 for empty or malformed
 * input (defensive against unexpected API responses).
 */
export function parseHorizonBalanceToStroops(
  balanceString: string | undefined,
): bigint {
  if (!balanceString || balanceString.trim() === "") return 0n;
  try {
    return parseXlmToStroops(balanceString);
  } catch {
    return 0n;
  }
}

/** Format stroops as an XLM string with trailing zeros removed. */
export function formatStroopsToXlm(stroops: bigint): string {
  const isNegative = stroops < 0n;
  const absolute = isNegative ? -stroops : stroops;

  const stroopsString = absolute.toString().padStart(MAX_DECIMALS + 1, "0");
  const integerPart = stroopsString.slice(0, -MAX_DECIMALS) || "0";
  const decimalPart = stroopsString.slice(-MAX_DECIMALS);
  const trimmedDecimal = decimalPart.replace(/0+$/, "");

  if (trimmedDecimal === "") {
    return isNegative ? `-${integerPart}` : integerPart;
  }
  return isNegative
    ? `-${integerPart}.${trimmedDecimal}`
    : `${integerPart}.${trimmedDecimal}`;
}

/** Alias for {@link formatStroopsToXlm}. */
export const formatXlm = formatStroopsToXlm;
