/**
 * Client-side deposit amount validation, so a malformed deposit fails locally
 * instead of spending network fees on a transaction the pool contract will
 * revert (non-positive `value`) or that would otherwise produce a note the
 * circuit can't prove over (a value at or above the BN254 scalar field).
 *
 * Bounds are checked against the pool's *live* configuration (read via
 * `PrivacyPool.getConfig` / `getNativeAssetDecimals`), not a hardcoded assumption,
 * so a differently-configured deployment is validated correctly.
 */
import { BN254_R } from "../crypto/notes";
import { PoolValidationError } from "../errors/index";

export interface DepositAmountInput {
  /** The raw decimal XLM string as given by the caller (pre-parse). */
  amountXlm: string;
  /** `amountXlm` parsed to stroops. */
  valueStroops: bigint;
  /** Live decimal precision of the pool's backing asset. */
  decimals: number;
}

function fractionalDigits(amountXlm: string): number {
  const unsigned = amountXlm.trim().replace(/^-/, "");
  const dot = unsigned.indexOf(".");
  return dot === -1 ? 0 : unsigned.length - dot - 1;
}

/**
 * Validate a deposit amount against pool constraints. Throws
 * {@link PoolValidationError} naming the violated constraint:
 * - `"non-positive"`: value is zero or negative.
 * - `"exceeds-field-modulus"`: value is too large to be a circuit input.
 * - `"precision"`: more decimal places than the backing asset supports.
 */
export function validateDepositAmount(input: DepositAmountInput): void {
  if (input.valueStroops <= 0n) {
    throw new PoolValidationError(
      `Deposit amount must be positive, got ${input.amountXlm} XLM (${input.valueStroops} stroops)`,
      "non-positive",
    );
  }
  if (input.valueStroops >= BN254_R) {
    throw new PoolValidationError(
      `Deposit amount ${input.valueStroops} stroops exceeds the field modulus and cannot be committed`,
      "exceeds-field-modulus",
    );
  }
  const digits = fractionalDigits(input.amountXlm);
  if (digits > input.decimals) {
    throw new PoolValidationError(
      `Deposit amount ${input.amountXlm} has ${digits} decimal places, more than the pool's ` +
        `backing asset supports (${input.decimals})`,
      "precision",
    );
  }
}
