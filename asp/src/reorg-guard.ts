/**
 * Ledger reorg (continuity) verification. Tracks the expected next ledger after each
 * event batch and halts publication when a gap or rollback is detected, giving operators
 * a safe re-index path instead of baking a suspect root into the published manifest.
 */
export interface ReorgGuardConfig {
  /** Callback invoked when a continuity break is detected. */
  onDivergence: (event: ReorgEvent) => void;
  /** Optional: current time provider. */
  now?: () => number;
}

export interface ReorgEvent {
  type: "continuity-break";
  expectedLedger: number;
  actualLedger: number;
  /** Whether the index was rewound to this ledger. */
  rewoundTo: number;
  message: string;
  timestamp: string;
}

/**
 * Guards the indexer cursor against ledger discontinuities. After each event batch the
 * caller feeds the latest ledger seen; if the next batch starts from a ledger that is
 * *before* the previous batch's latest, a divergence is flagged and the guard returns
 * the safe re-index cursor.
 */
export class ReorgGuard {
  private expectedNextLedger = 0;
  private cfg: ReorgGuardConfig;

  constructor(cfg: ReorgGuardConfig) {
    this.cfg = cfg;
  }

  /** Reset the guard (e.g. on cold start). */
  reset(fromLedger: number): void {
    this.expectedNextLedger = fromLedger;
  }

  /**
   * Validate that `batchStartLedger` is continuous with the previous batch.
   * Returns `{ ok: true }` if the cursor is safe, or `{ ok: false, rewindTo }` with the
   * ledger the caller should re-scan from.
   */
  validate(batchStartLedger: number): { ok: true } | { ok: false; rewindTo: number } {
    if (this.expectedNextLedger === 0) {
      // First batch — seed the cursor.
      this.expectedNextLedger = batchStartLedger;
      return { ok: true };
    }

    if (batchStartLedger >= this.expectedNextLedger) {
      // Normal progression or gap (gap is acceptable if the RPC skipped empty ledgers).
      this.expectedNextLedger = batchStartLedger;
      return { ok: true };
    }

    // Rollback detected — rewind to the start of the broken batch.
    const rewindTo = batchStartLedger;
    const event: ReorgEvent = {
      type: "continuity-break",
      expectedLedger: this.expectedNextLedger,
      actualLedger: batchStartLedger,
      rewoundTo: rewindTo,
      message: `Ledger continuity break: expected ≥${this.expectedNextLedger}, got ${batchStartLedger}. Rewinding to ${rewindTo}.`,
      timestamp: new Date(this.cfg.now ? this.cfg.now() : Date.now()).toISOString(),
    };
    this.cfg.onDivergence(event);
    this.expectedNextLedger = batchStartLedger;
    return { ok: false, rewindTo };
  }

  /** Record that a batch completed successfully at `lastLedger`. */
  commit(lastLedger: number): void {
    this.expectedNextLedger = lastLedger + 1;
  }
}
