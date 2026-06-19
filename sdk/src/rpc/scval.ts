/**
 * ScVal conversion helpers for building Soroban contract-call arguments.
 * Thin, typed wrappers over `@stellar/stellar-sdk` so callers never hand-roll
 * `nativeToScVal` type tags.
 */
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

/** Stellar address (G/C-strkey) -> ScVal address. */
export function addressToScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

/** Raw bytes -> ScVal bytes. */
export function bytesToScVal(bytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/** Number/bigint -> ScVal u32. */
export function u32ToScVal(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" });
}

/** Number/bigint -> ScVal u64. */
export function u64ToScVal(n: bigint | number): xdr.ScVal {
  return nativeToScVal(n, { type: "u64" });
}

/** Bigint -> ScVal i128 (Soroban's signed amount type). */
export function i128ToScVal(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}

/** Bigint -> ScVal u128. */
export function u128ToScVal(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "u128" });
}

/** String -> ScVal symbol. */
export function symbolToScVal(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

/** String -> ScVal string. */
export function stringToScVal(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
}

/** Boolean -> ScVal bool. */
export function boolToScVal(b: boolean): xdr.ScVal {
  return nativeToScVal(b, { type: "bool" });
}

/** Optional address -> ScVal address, or a void ScVal when null/undefined. */
export function optionAddressToScVal(addr: string | null | undefined): xdr.ScVal {
  return addr ? addressToScVal(addr) : nativeToScVal(null, { type: "address" });
}

/** Decode an ScVal into its native JS representation. */
export function fromScVal(v: xdr.ScVal): unknown {
  return scValToNative(v);
}
