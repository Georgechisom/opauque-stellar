/**
 * Typed interface to the Rust/WASM DKSAP scanner. The scanner does the
 * performance-critical view-tag filtering, stealth-key reconstruction, and
 * reputation-witness generation. The binary ships with the package and is loaded
 * lazily by an environment-specific {@link ScannerLoader} (browser instantiates
 * via `WebAssembly`, Node reads the file); both resolve to this interface.
 *
 * Pure-TS equivalents for the simplest operations live in `crypto/dksap`
 * (`checkViewTagMatch`, `reconstructStealthPrivateKey`) for environments that
 * cannot load WASM.
 */
export interface ScannerModule {
  derive_stealth_address_wasm(
    viewPrivkeyBytes: Uint8Array,
    spendPubkeyBytes: Uint8Array,
    ephemeralPubkeyBytes: Uint8Array,
  ): { stealthAddress: string; viewTag: number };

  check_announcement_view_tag_wasm(
    viewTag: number,
    viewPrivkeyBytes: Uint8Array,
    ephemeralPubkeyBytes: Uint8Array,
  ): string; // "NoMatch" | "PossibleMatch"

  reconstruct_signing_key_wasm(
    masterSpendPrivBytes: Uint8Array,
    masterViewPrivBytes: Uint8Array,
    ephemeralPubkeyBytes: Uint8Array,
  ): Uint8Array;

  scan_attestations_wasm(
    announcementsJson: string,
    viewPrivkeyBytes: Uint8Array,
    spendPubkeyBytes: Uint8Array,
  ): string;

  scan_attestations_v2_wasm(
    announcementsJson: string,
    schemasJson: string,
    viewPrivkeyBytes: Uint8Array,
    spendPubkeyBytes: Uint8Array,
    currentSlot: bigint,
    trustedIssuersJson: string,
  ): string;

  generate_reputation_witness(
    attestationsJson: string,
    targetTraitId: string,
    stealthPrivkeyBytes: Uint8Array,
    externalNullifier: string,
  ): string;

  encode_attestation_metadata_wasm(viewTag: number, attestationId: bigint): string;

  get_scanner_metadata(): string;
}

/**
 * View-only scan result — identifies incoming transfers without spend keys.
 */
export interface ViewOnlyScanResult {
  /** Stealth address from the announcement. */
  stealthAddress: string;
  /** Whether the announcement belongs to this recipient. */
  isOurs: boolean;
}

/** Lazily load and instantiate the scanner module. */
export type ScannerLoader = () => Promise<ScannerModule>;
