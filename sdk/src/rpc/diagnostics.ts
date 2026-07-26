/**
 * Decode Soroban diagnostic events and ScErrors from a failed transaction into
 * short, human-readable strings, and extract a contract error code when present.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";

/** Render an ScError into a short token like `ContractError#4` or `sceBudget`. */
export function describeScError(e: xdr.ScError): string {
  const type = e.switch().name; // sceContract, sceStorage, sceBudget, ...
  if (type === "sceContract") {
    try {
      return `ContractError#${e.contractCode()}`;
    } catch {
      return "ContractError";
    }
  }
  try {
    return `${type}/${e.code().name}`;
  } catch {
    return type;
  }
}

function scValToReadable(v: xdr.ScVal): unknown {
  try {
    if (v.switch().name === "scvError") return describeScError(v.error());
    return scValToNative(v);
  } catch {
    try {
      return v.switch().name;
    } catch {
      return "?";
    }
  }
}

/**
 * Decode an array of diagnostic events (XDR) into a compact, de-duplicated
 * string. Bounded to keep error messages readable.
 */
export function decodeDiagnostics(events: unknown[]): string {
  const parts: string[] = [];
  for (const raw of events) {
    try {
      const de = raw as xdr.DiagnosticEvent;
      const v0 = de.event().body().v0();
      const topics = v0.topics().map(scValToReadable);
      const data = scValToReadable(v0.data());
      parts.push(JSON.stringify({ topics, data }));
    } catch {
      /* skip events that cannot be decoded */
    }
  }
  return Array.from(new Set(parts)).join(" | ").slice(0, 1500);
}

/** Parse the "ledger range: X - Y" hint from a `getEvents` range error. */
export function parseOldestLedgerFromRangeError(err: unknown): number | null {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown })?.message === "string"
          ? (err as { message: string }).message
          : "";
  const m = /ledger range:\s*(\d+)\s*-\s*(\d+)/.exec(msg);
  return m ? Number(m[1]) : null;
}

/**
 * Best-effort extraction of a contract error code from diagnostic events.
 * Returns the first `ContractError#N` code found, or null.
 */
export function extractContractErrorCode(events: unknown[]): number | null {
  for (const raw of events) {
    try {
      const de = raw as xdr.DiagnosticEvent;
      const v0 = de.event().body().v0();
      for (const t of v0.topics()) {
        if (t.switch().name === "scvError") {
          const err = t.error();
          if (err.switch().name === "sceContract") return err.contractCode();
        }
      }
      const data = v0.data();
      if (data.switch().name === "scvError") {
        const err = data.error();
        if (err.switch().name === "sceContract") return err.contractCode();
      }
    } catch {
      /* keep scanning */
    }
  }
  return null;
}
