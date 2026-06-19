/**
 * Pluggable telemetry hooks. The SDK emits structured events at meaningful
 * points (contract calls, scans) so a host app can wire its own metrics without
 * the SDK depending on any monitoring library. All hooks are optional; the
 * default is a no-op.
 */

export interface ContractCallEvent {
  contractId: string;
  method: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface ScannerSyncEvent {
  fromLedger: number;
  toLedger: number;
}

export interface Telemetry {
  onContractCall?(event: ContractCallEvent): void;
  onScannerSync?(event: ScannerSyncEvent): void;
}

/** Default telemetry: records nothing. */
export const noopTelemetry: Telemetry = {};
