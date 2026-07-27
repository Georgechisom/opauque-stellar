/**
 * Publication monitoring. Tracks when the ASP root was last published and fires alerts
 * when the root exceeds a configured staleness threshold — operators learn about silent
 * publication failures before users complain.
 */
export interface PublicationMonitorConfig {
  /** Maximum age (ms) of the last published root before an alert fires. */
  maxRootAgeMs: number;
  /** Callback invoked when an alert condition is detected. */
  onAlert: (alert: PublicationAlert) => void;
  /** Optional: current time provider (for deterministic tests). */
  now?: () => number;
}

export interface PublicationAlert {
  type: "stale-root";
  /** ISO timestamp of the last known publication. */
  lastPublishedAt: string;
  /** The root hash that is now stale. */
  lastRoot: string;
  /** Ledger at which the root was last published. */
  lastLedger: number;
  /** How long (ms) since the last publication. */
  ageMs: number;
  /** Configured threshold that was exceeded. */
  thresholdMs: number;
  message: string;
}

/**
 * Lightweight monitor that wraps the engine tick result. Call `recordPublication` after
 * each successful publish and `check` on a timer (or after each tick) to detect staleness.
 */
export class PublicationMonitor {
  private lastPublishedAt = 0;
  private lastRoot: string | null = null;
  private lastLedger = 0;
  private cfg: PublicationMonitorConfig;

  constructor(cfg: PublicationMonitorConfig) {
    this.cfg = cfg;
  }

  /** Record a successful publication. */
  recordPublication(root: string, ledger: number): void {
    this.lastPublishedAt = this.cfg.now ? this.cfg.now() : Date.now();
    this.lastRoot = root;
    this.lastLedger = ledger;
  }

  /**
   * Check whether the latest root has gone stale. Returns the alert if fired, or null
   * if the publication cycle is healthy.
   */
  check(): PublicationAlert | null {
    if (this.lastPublishedAt === 0) return null; // nothing published yet
    const now = this.cfg.now ? this.cfg.now() : Date.now();
    const ageMs = now - this.lastPublishedAt;
    if (ageMs <= this.cfg.maxRootAgeMs) return null;
    const alert: PublicationAlert = {
      type: "stale-root",
      lastPublishedAt: new Date(this.lastPublishedAt).toISOString(),
      lastRoot: this.lastRoot!,
      lastLedger: this.lastLedger,
      ageMs,
      thresholdMs: this.cfg.maxRootAgeMs,
      message: `ASP root ${this.lastRoot!.slice(0, 14)}… published at ledger ${this.lastLedger} is ${ageMs}ms old (threshold ${this.cfg.maxRootAgeMs}ms)`,
    };
    this.cfg.onAlert(alert);
    return alert;
  }
}
