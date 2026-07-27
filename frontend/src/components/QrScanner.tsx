import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

type QrScannerProps = {
  onScan: (result: string) => void;
  onClose: () => void;
};

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          onScan(decodedText);
          scanner.stop().catch(() => {});
        },
        () => {},
      )
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Permission|NotAllowed|PermissionDenied/.test(msg)) {
          setError("Camera permission denied. Please allow camera access and try again.");
        } else {
          setError("Failed to start camera: " + msg);
        }
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear();
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-neutral-900 rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Scan QR Code</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-sm"
          >
            Cancel
          </button>
        </div>

        <p className="text-xs text-neutral-400">
          Point your camera at a QR code containing a Stellar address or stealth meta-address.
        </p>

        {error ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : (
          <div id="qr-reader" ref={containerRef} className="rounded-lg overflow-hidden" />
        )}

        <p className="text-[11px] text-neutral-500 text-center">
          Camera permission is requested only when scanning is opened.
        </p>
      </div>
    </div>
  );
}
