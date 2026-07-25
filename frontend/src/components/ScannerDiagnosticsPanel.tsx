import { useEffect, useState } from "react";
import { useOpaqueWasm } from "../hooks/useOpaqueWasm";

interface ScannerMetadata {
  version: string;
  buildHash: string;
}

export function ScannerDiagnosticsPanel() {
  const { wasm, isReady } = useOpaqueWasm();
  const [metadata, setMetadata] = useState<ScannerMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wasm || !isReady) return;
    try {
      const json = wasm.get_scanner_metadata();
      const parsed = JSON.parse(json) as ScannerMetadata;
      setMetadata(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read scanner metadata");
    }
  }, [wasm, isReady]);

  if (!isReady || !metadata) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900/30 px-4 py-3">
        <p className="text-sm text-mist">Scanner diagnostics loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-neutral-500/30 bg-neutral-500/10 px-4 py-3">
        <p className="text-sm text-neutral-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Scanner Diagnostics</h3>
          <p className="text-xs text-mist mt-0.5">
            WASM scanner build information
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-900/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Version</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-neutral-400/30 bg-neutral-400/10 px-2 py-0.5 text-[11px] font-mono font-medium text-neutral-300">
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" aria-hidden />
            v{metadata.version}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-900/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Build Hash</p>
            <p className="text-[11px] font-mono text-mist/60 mt-0.5 break-all" title={metadata.buildHash}>
              {metadata.buildHash}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
