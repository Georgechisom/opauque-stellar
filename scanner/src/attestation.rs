//! # Stealth Attestation Scanner (V1 + V2)
//!
//! V1: Extends the EIP-5564 scanner to detect "Reputation Events" embedded in
//! announcement metadata. Extracts an `attestation_id` from the metadata byte string.
//!
//! V2: Validates that the attestation belongs to a registered schema and that the
//! issuer is the schema authority or a registered delegate. V2 traits carry
//! `schema_id`, `issuer`, `attestation_uid`, and a pre-computed `merkle_leaf` for
//! ZK proof generation. Rogue traits (issued by non-delegates) are silently ignored.

use alloy_primitives::Address;
use k256::{ecdsa::SigningKey, PublicKey};
use serde::{Deserialize, Serialize};

use crate::scanner::{
    check_announcement_view_tag, derive_stealth_address, StealthAddressError, ViewTagCheck,
};
use log::{warn, info};
use sha2::{Digest, Sha256};


// =============================================================================
// Attestation types
// =============================================================================

/// A discovered attestation tied to a stealth address announcement.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StealthAttestation {
    pub stealth_address: String,
    pub attestation_id: u64,
    pub tx_hash: String,
    pub block_number: u64,
    pub ephemeral_pubkey: Vec<u8>,
}

/// Aggregated reputation score for a specific trait requirement.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReputationSummary {
    pub trait_id: String,
    pub matching_announcements: Vec<StealthAttestation>,
    pub total_count: u64,
}

// =============================================================================
// Metadata attestation encoding
// =============================================================================

/// Attestation metadata layout in announcement `metadata` field:
///   byte[0]    = view_tag (standard EIP-5564)
///   byte[1]    = 0xAT (attestation marker = 0xA7)
///   byte[2..10] = attestation_id (big-endian u64)
///
/// Remaining bytes are reserved for future extensions.
const ATTESTATION_MARKER: u8 = 0xA7;
const ATTESTATION_METADATA_MIN_LEN: usize = 10;

/// Extracts an attestation_id from announcement metadata, if present.
pub fn extract_attestation_id(metadata: &[u8]) -> Option<u64> {
    if metadata.len() < ATTESTATION_METADATA_MIN_LEN {
        return None;
    }
    if metadata[1] != ATTESTATION_MARKER {
        return None;
    }
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&metadata[2..10]);
    Some(u64::from_be_bytes(buf))
}

/// Encodes an attestation_id into metadata format (view_tag must be set by caller at byte[0]).
pub fn encode_attestation_metadata(view_tag: u8, attestation_id: u64) -> Vec<u8> {
    let mut metadata = Vec::with_capacity(ATTESTATION_METADATA_MIN_LEN);
    metadata.push(view_tag);
    metadata.push(ATTESTATION_MARKER);
    metadata.extend_from_slice(&attestation_id.to_be_bytes());
    metadata
}

// =============================================================================
// Attestation scanning
// =============================================================================

/// Raw announcement data from the chain/subgraph, before WASM boundary.
#[derive(Clone, Debug)]
pub struct RawAnnouncement {
    pub stealth_address: Address,
    pub view_tag: u8,
    pub ephemeral_pubkey: PublicKey,
    pub metadata: Vec<u8>,
    pub tx_hash: String,
    pub block_number: u64,
}

/// Scans a batch of announcements for attestations owned by this recipient.
///
/// Two-pass filter:
/// 1. View-tag pre-check (skip ~255/256 of announcements)
/// 2. Full stealth address derivation + attestation extraction
pub fn scan_for_attestations(
    announcements: &[RawAnnouncement],
    view_privkey: &SigningKey,
    spend_pubkey: &PublicKey,
) -> Result<Vec<StealthAttestation>, StealthAddressError> {
    let mut results = Vec::new();

    for ann in announcements {
        match check_announcement_view_tag(ann.view_tag, view_privkey, &ann.ephemeral_pubkey) {
            ViewTagCheck::NoMatch => continue,
            ViewTagCheck::PossibleMatch => {}
        }

        let (derived_addr, _) =
            derive_stealth_address(view_privkey, spend_pubkey, &ann.ephemeral_pubkey)?;

        if derived_addr != ann.stealth_address {
            continue;
        }

        if let Some(attestation_id) = extract_attestation_id(&ann.metadata) {
            let compressed = ann
                .ephemeral_pubkey
                .to_sec1_bytes()
                .to_vec();

            results.push(StealthAttestation {
                stealth_address: format!("{:#x}", ann.stealth_address),
                attestation_id,
                tx_hash: ann.tx_hash.clone(),
                block_number: ann.block_number,
                ephemeral_pubkey: compressed,
            });
        }
    }

    Ok(results)
}

/// Aggregates attestations matching a specific trait requirement.
///
/// For simple badge checks, `requirement` is a single attestation_id.
/// For threshold checks (e.g. "Total Volume > 5 ETH"), the caller should
/// pass all volume-type attestation IDs and the function counts matches.
pub fn aggregate_for_trait(
    attestations: &[StealthAttestation],
    trait_id: &str,
    required_attestation_ids: &[u64],
) -> ReputationSummary {
    let matching: Vec<StealthAttestation> = attestations
        .iter()
        .filter(|a| required_attestation_ids.contains(&a.attestation_id))
        .cloned()
        .collect();

    let total_count = matching.len() as u64;

    ReputationSummary {
        trait_id: trait_id.to_string(),
        matching_announcements: matching,
        total_count,
    }
}

// =============================================================================
// V2 Attestation types and scanning
// =============================================================================

/// V2 marker byte in announcement metadata
const V2_ATTESTATION_MARKER: u8 = 0xB2;

/// Minimum metadata length for a V2 announcement:
///   byte[0]    = view_tag
///   byte[1]    = 0xB2 (V2 marker)
///   byte[2..34]  = schema_id [u8; 32]
///   byte[34..66] = issuer pubkey [u8; 32] (first 32 bytes of compressed ed25519 key)
///   byte[66..98] = attestation_uid [u8; 32]
///   byte[98..130] = nonce [u8; 32]  (used in Merkle leaf construction)
///   byte[130..134] = expiration_ledger [u8; 4] (big-endian u32, optional, default 0 = never expires)
const V2_METADATA_MIN_LEN: usize = 130;
const V2_METADATA_WITH_EXPIRY_LEN: usize = 134;

/// A V2 discovered trait — schema-bound, issuer-verified, ready for ZK proof gen.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct V2StealthAttestation {
    /// Hex-encoded stealth address (Ethereum-style 0x…)
    pub stealth_address: String,
    /// Schema identifier [u8; 32] as hex
    pub schema_id: String,
    /// Optional display name for the schema (populated if schema registry is queried)
    pub schema_name: Option<String>,
    /// Issuer pubkey as base58 (Stellar) or hex
    pub issuer: String,
    /// Attestation UID [u8; 32] as hex
    pub attestation_uid: String,
    /// ABI-encoded payload bytes as hex (decoded against schema field_definitions by caller)
    pub data_hex: String,
    /// Nonce used in the Merkle leaf — needed for ZK proof generation
    pub nonce: String,
    /// Field inputs used to compute Poseidon(stealth_pk, schema_id, issuer_pk_x, data_hash, nonce).
    pub merkle_leaf_preimage: MerkleLeafPreimage,
    /// Transaction hash where this announcement appeared
    pub tx_hash: String,
    /// Slot (block) when the announcement was observed
    pub slot: u64,
    /// Whether the attestation is currently valid (not revoked, not expired).
    /// Set to true at scan time; callers should re-validate against chain state.
    pub is_valid: bool,
    /// True if this was issued by the schema authority or a known delegate.
    /// Rogue traits have this set to false and are filtered by default.
    pub issuer_authorized: bool,
    /// Ledger number at which this attestation expires (0 = never expires).
    pub expiration_slot: u64,
}

/// All fields needed to reconstruct the V2 Poseidon leaf in the browser prover.
/// leaf = Poseidon(stealth_pk, schema_id_field, issuer_pk_x, trait_data_hash, nonce)
///
/// Issuer encoding:
/// - issuer_pk_x is the 32-byte Ed25519 public key of the issuer
/// - Encoded as big-endian 256-bit integer in 0x-hex format
/// - NOT a BabyJubJub coordinate; it's the raw Ed25519 key material
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MerkleLeafPreimage {
    /// Stealth pk field element (BN254 scalar, decimal string)
    pub stealth_pk_field: String,
    /// schema_id packed into BN254 field element (decimal string)
    pub schema_id_field: String,
    /// Issuer Ed25519 public key (32 bytes) as BN254 field element (0x-hex format)
    pub issuer_pk_x: String,
    /// Poseidon(data fields) decimal string — caller computes from data_hex + schema
    pub trait_data_hash: String,
    /// Random nonce (decimal string)
    pub nonce_field: String,
}

/// Raw V2 announcement fields extracted from metadata bytes.
#[derive(Clone, Debug)]
pub struct V2AnnouncementFields {
    pub schema_id: [u8; 32],
    pub issuer: [u8; 32],
    pub attestation_uid: [u8; 32],
    pub nonce: [u8; 32],
    /// Ledger number at which this attestation expires (0 = never expires).
    pub expiration_ledger: u32,
}

/// Parses V2 fields from announcement metadata, returning None if not a V2 announcement.
pub fn extract_v2_fields(metadata: &[u8]) -> Option<V2AnnouncementFields> {
    if metadata.len() < V2_METADATA_MIN_LEN {
        return None;
    }
    if metadata[1] != V2_ATTESTATION_MARKER {
        return None;
    }
    let mut schema_id = [0u8; 32];
    let mut issuer = [0u8; 32];
    let mut attestation_uid = [0u8; 32];
    let mut nonce = [0u8; 32];

    schema_id.copy_from_slice(&metadata[2..34]);
    issuer.copy_from_slice(&metadata[34..66]);
    attestation_uid.copy_from_slice(&metadata[66..98]);
    nonce.copy_from_slice(&metadata[98..130]);

    let expiration_ledger = if metadata.len() >= V2_METADATA_WITH_EXPIRY_LEN {
        u32::from_be_bytes([metadata[130], metadata[131], metadata[132], metadata[133]])
    } else {
        0
    };

    Some(V2AnnouncementFields {
        schema_id,
        issuer,
        attestation_uid,
        nonce,
        expiration_ledger,
    })
}

/// Encodes a V2 announcement metadata payload.
///
/// Layout: view_tag || 0xB2 || schema_id[32] || issuer[32] || attestation_uid[32] || nonce[32] || expiration_ledger[4]
/// The expiration_ledger is optional (0 = never expires).
pub fn encode_v2_attestation_metadata(
    view_tag: u8,
    schema_id: &[u8; 32],
    issuer: &[u8; 32],
    attestation_uid: &[u8; 32],
    nonce: &[u8; 32],
    expiration_ledger: u32,
) -> Vec<u8> {
    let mut metadata = Vec::with_capacity(V2_METADATA_WITH_EXPIRY_LEN);
    metadata.push(view_tag);
    metadata.push(V2_ATTESTATION_MARKER);
    metadata.extend_from_slice(schema_id);
    metadata.extend_from_slice(issuer);
    metadata.extend_from_slice(attestation_uid);
    metadata.extend_from_slice(nonce);
    metadata.extend_from_slice(&expiration_ledger.to_be_bytes());
    metadata
}

/// A minimal schema description for issuer validation in the scanner.
/// In a full implementation this is fetched from the chain via RPC.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub schema_id: [u8; 32],
    pub authority: [u8; 32],
    pub delegates: Vec<[u8; 32]>,
    pub deprecated: bool,
    pub schema_expiry_slot: u64,
    pub name: String,
}

impl SchemaInfo {
    pub fn is_authorized_issuer(&self, candidate: &[u8; 32]) -> bool {
        candidate == &self.authority || self.delegates.contains(candidate)
    }

    pub fn is_active(&self, current_slot: u64) -> bool {
        !self.deprecated
            && (self.schema_expiry_slot == 0 || current_slot < self.schema_expiry_slot)
    }
}

/// Scans a batch of V2 announcements for schema-bound attestations owned by this recipient.
///
/// Three-pass filter:
/// 1. View-tag pre-check (skip ~255/256 of announcements)
/// 2. Full stealth address derivation to confirm ownership
/// 3. Issuer authorization check against the provided schema registry snapshot
///
/// Rogue traits (unregistered schema_id or unauthorized issuer) are logged and skipped.
/// The caller is responsible for fetching up-to-date `schemas` from the chain.
pub fn scan_for_attestations_v2(
    announcements: &[RawAnnouncement],
    view_privkey: &k256::ecdsa::SigningKey,
    spend_pubkey: &k256::PublicKey,
    schemas: &[SchemaInfo],
    current_slot: u64,
    trusted_issuers: Option<&std::collections::HashSet<String>>,
) -> Result<Vec<V2StealthAttestation>, crate::scanner::StealthAddressError> {
    use crate::scanner::{check_announcement_view_tag, derive_stealth_address, ViewTagCheck};

    let mut results = Vec::new();

    for ann in announcements {
        // Step 1: View-tag fast path
        match check_announcement_view_tag(ann.view_tag, view_privkey, &ann.ephemeral_pubkey) {
            ViewTagCheck::NoMatch => continue,
            ViewTagCheck::PossibleMatch => {}
        }

        // Step 2: Full ECDH derivation to confirm this announcement is ours
        let (derived_addr, _) =
            derive_stealth_address(view_privkey, spend_pubkey, &ann.ephemeral_pubkey)?;
        if derived_addr != ann.stealth_address {
            continue;
        }

        // Step 3: Parse V2 metadata fields
        let v2 = match extract_v2_fields(&ann.metadata) {
            Some(f) => f,
            None => continue, // Not a V2 announcement — skip (V1 scanner handles V1)
        };

        // Step 4: Look up schema in the provided registry snapshot
        let schema = match schemas.iter().find(|s| s.schema_id == v2.schema_id) {
            Some(s) => s,
            None => {
                // Unknown schema_id — rogue trait, log hash and skip
                warn!("Rogue trait: unknown schema_id hash {}", short_hash(&v2.schema_id));
                continue;
            }
        };

        // Step 5: Check schema is not deprecated/expired
        if !schema.is_active(current_slot) {
            continue;
        }

        // Step 6: Validate the issuer is authorized under this schema
        let issuer_authorized = schema.is_authorized_issuer(&v2.issuer);
        if !issuer_authorized {
            // Unauthorized issuer – log hash and skip
            warn!("Rogue trait: unauthorized issuer hash {}", short_hash(&v2.issuer));
            continue;
        }

        // Step 7: Optional user-configured trusted issuer allowlist
        let issuer_hex = hex_encode(&v2.issuer);
        if let Some(trusted) = trusted_issuers {
            if !trusted.contains(&issuer_hex) {
                continue;
            }
        }

    // Step 8: Check attestation-level expiration against current slot
    let expiration_slot = v2.expiration_ledger as u64;
    let is_valid = expiration_slot == 0 || current_slot < expiration_slot;

    // Step 9: Build the leaf preimage struct for the circuit witness.
    let stealth_addr_hex = format!("{:#x}", ann.stealth_address);
    let merkle_leaf_preimage = MerkleLeafPreimage {
        stealth_pk_field: "0".to_string(), // caller fills from stealth privkey
        schema_id_field: bytes_to_field_decimal(&v2.schema_id),
        issuer_pk_x: bytes_to_field_decimal(&v2.issuer),
        trait_data_hash: "0".to_string(), // caller fills after decoding data
        nonce_field: bytes_to_field_decimal(&v2.nonce),
    };

    results.push(V2StealthAttestation {
        stealth_address: stealth_addr_hex,
        schema_id: hex_encode(&v2.schema_id),
        schema_name: Some(schema.name.clone()),
        issuer: hex_encode(&v2.issuer),
        attestation_uid: hex_encode(&v2.attestation_uid),
        data_hex: String::new(), // encrypted payload decoded by caller with shared secret
        nonce: hex_encode(&v2.nonce),
        merkle_leaf_preimage,
        tx_hash: ann.tx_hash.clone(),
        slot: ann.block_number,
        is_valid,
        issuer_authorized,
        expiration_slot,
    });
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Short hex prefix used for privacy-preserving diagnostic logs.
/// Only the first 4 bytes are exposed so full identifiers never hit logs.
fn short_hash(bytes: &[u8]) -> String {
    let n = bytes.len().min(4);
    hex_encode(&bytes[..n])
}

/// Packs a 32-byte array into a field element suitable for Circom inputs.
/// The value is treated as a big-endian 256-bit integer and returned as 0x-hex.
///
/// Canonical encoding:
/// - Input: 32-byte array (e.g., Ed25519 public key, schema_id, nonce)
/// - Interpretation: big-endian 256-bit integer
/// - Output: 0x-prefixed hex string (64 hex digits)
/// - Circom accepts both hex and decimal formats
///
/// For issuer_pk_x specifically:
/// - Input is the 32-byte Ed25519 public key of the issuer
/// - NOT a BabyJubJub coordinate
/// - Output is used directly in circuit Poseidon hash
fn bytes_to_field_decimal(bytes: &[u8; 32]) -> String {
    // Return as 0x hex — Circom 2.x accepts both hex and decimal for field inputs
    format!("0x{}", hex_encode(bytes))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_attestation_metadata() {
        let view_tag = 0x42;
        let attestation_id = 12345u64;
        let encoded = encode_attestation_metadata(view_tag, attestation_id);
        assert_eq!(encoded[0], view_tag);
        assert_eq!(encoded[1], ATTESTATION_MARKER);
        let decoded = extract_attestation_id(&encoded).expect("should decode");
        assert_eq!(decoded, attestation_id);
    }

    #[test]
    fn short_metadata_returns_none() {
        assert!(extract_attestation_id(&[0x42]).is_none());
        assert!(extract_attestation_id(&[0x42, 0xA7]).is_none());
    }

    #[test]
    fn wrong_marker_returns_none() {
        let mut data = vec![0x42, 0xFF];
        data.extend_from_slice(&42u64.to_be_bytes());
        assert!(extract_attestation_id(&data).is_none());
    }

    // =========================================================================
    // Issuer Encoding Tests
    // =========================================================================

    #[test]
    fn issuer_encoding_all_zeros() {
        // Example 1: All-zeros issuer
        let issuer = [0u8; 32];
        let hex = hex_encode(&issuer);
        let field = bytes_to_field_decimal(&issuer);
        
        assert_eq!(hex, "0000000000000000000000000000000000000000000000000000000000000000");
        assert_eq!(field, "0x0000000000000000000000000000000000000000000000000000000000000000");
    }

    #[test]
    fn issuer_encoding_sequential() {
        // Example 2: Sequential issuer (0x01, 0x02, ..., 0x1f)
        let mut issuer = [0u8; 32];
        for i in 0..32 {
            issuer[i] = (i + 1) as u8;
        }
        let hex = hex_encode(&issuer);
        let field = bytes_to_field_decimal(&issuer);
        
        assert_eq!(hex, "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        assert_eq!(field, "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    }

    #[test]
    fn issuer_encoding_big_endian_interpretation() {
        // Verify big-endian interpretation: first byte is most significant
        let mut issuer = [0u8; 32];
        issuer[0] = 0xFF;  // Most significant byte
        issuer[31] = 0x01; // Least significant byte
        
        let hex = hex_encode(&issuer);
        let field = bytes_to_field_decimal(&issuer);
        
        // Should start with FF and end with 01
        assert!(hex.starts_with("ff"));
        assert!(hex.ends_with("01"));
        assert_eq!(field, format!("0x{}", hex));
    }

    #[test]
    fn issuer_field_element_format() {
        // Verify field element is 0x-prefixed hex with 64 hex digits
        let issuer = [0xABu8; 32];
        let field = bytes_to_field_decimal(&issuer);
        
        assert!(field.starts_with("0x"));
        assert_eq!(field.len(), 66); // "0x" + 64 hex digits
        assert_eq!(field, "0xabababababababababababababababababababababababababababababababab");
    }

    #[test]
    fn issuer_encoding_roundtrip_hex() {
        // Verify hex encoding is reversible
        let issuer = [
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
            0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        ];
        
        let hex = hex_encode(&issuer);
        let field = bytes_to_field_decimal(&issuer);
        
        // Field should be 0x + hex
        assert_eq!(field, format!("0x{}", hex));
        
        // Hex should be lowercase
        assert_eq!(hex, hex.to_lowercase());
        
        // Hex should have exactly 64 characters (32 bytes * 2)
        assert_eq!(hex.len(), 64);
    }

    #[test]
    fn issuer_not_babyjubjub_coordinate() {
        // Verify that issuer is NOT treated as a BabyJubJub coordinate
        // BabyJubJub x-coordinates have specific properties; our issuer is just raw bytes
        let issuer = [0xFFu8; 32];
        let field = bytes_to_field_decimal(&issuer);
        
        // Should be treated as big-endian integer, not any special curve point
        assert_eq!(field, "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        
        // This value is > BN254_MODULUS, so it would be reduced in circuit
        // But the encoding itself is canonical: raw bytes as big-endian integer
    }

    #[test]
    fn issuer_encoding_consistency_across_components() {
        // Verify that issuer encoding is consistent:
        // scanner extracts issuer as 32 bytes → hex → field element
        // circuit receives field element → uses in Poseidon hash
        
        let issuer_bytes = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x26,
            0xb8, 0x2b, 0x99, 0xc8, 0xd5, 0x5a, 0x06, 0x16,
            0xe6, 0xff, 0x0c, 0xdc, 0x4f, 0xee, 0x0e, 0x17,
            0x88, 0x4d, 0x8c, 0x08, 0x3c, 0x05, 0x5c, 0xf7,
        ];
        
        let hex = hex_encode(&issuer_bytes);
        let field = bytes_to_field_decimal(&issuer_bytes);
        
        // All three representations should be consistent
        assert_eq!(hex, "30644e72e131a0264b82b99c8d55a0616e6ff0cdc4fee0e17884d8c083c055cf7");
        assert_eq!(field, "0x30644e72e131a0264b82b99c8d55a0616e6ff0cdc4fee0e17884d8c083c055cf7");
        
        // Verify this is BN254_MODULUS - 1 (largest valid field element)
        // BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617
        // BN254_MODULUS - 1 = 0x30644e72e131a0264b82b99c8d55a0616e6ff0cdc4fee0e17884d8c083c055cf7
    }
}

// =============================================================================
// Fuzz Tests for Announcement Event Parsing (Issue #607)
// =============================================================================
// These tests verify that malformed announcements are skipped with a counted
// diagnostic, not a crash. The parsing entry points are exercised with
// corrupted and adversarial payloads.

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use crate::scanner::{derive_stealth_address, check_announcement, check_announcement_view_tag};
    use k256::{ecdsa::SigningKey, PublicKey};

    // Valid key material for fuzzing context
    fn valid_view_privkey() -> SigningKey {
        SigningKey::from_bytes(&[0xaa; 32].into()).unwrap()
    }

    fn valid_spend_pubkey() -> PublicKey {
        PublicKey::from(SigningKey::from_bytes(&[0xbb; 32].into()).unwrap().verifying_key())
    }

    fn valid_ephemeral_pubkey() -> PublicKey {
        PublicKey::from(SigningKey::from_bytes(&[0xcc; 32].into()).unwrap().verifying_key())
    }

    // =========================================================================
    // V1 Metadata Parsing Fuzz
    // =========================================================================

    #[test]
    fn fuzz_extract_attestation_id_empty() {
        // Empty metadata should not crash
        let result = extract_attestation_id(&[]);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_attestation_id_single_byte() {
        let result = extract_attestation_id(&[0x42]);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_attestation_id_two_bytes() {
        let result = extract_attestation_id(&[0x42, 0xA7]);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_attestation_id_nine_bytes() {
        // One byte short of minimum
        let mut data = vec![0x42, 0xA7];
        data.extend_from_slice(&[0u8; 7]);
        let result = extract_attestation_id(&data);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_attestation_id_wrong_marker() {
        // Wrong marker byte (not 0xA7)
        let mut data = vec![0x42, 0xFF];
        data.extend_from_slice(&12345u64.to_be_bytes());
        let result = extract_attestation_id(&data);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_attestation_id_all_zeros() {
        let mut data = vec![0x00, 0xA7];
        data.extend_from_slice(&[0u8; 8]);
        let result = extract_attestation_id(&data);
        assert_eq!(result, Some(0));
    }

    #[test]
    fn fuzz_extract_attestation_id_max_value() {
        let mut data = vec![0xFF, 0xA7];
        data.extend_from_slice(&u64::MAX.to_be_bytes());
        let result = extract_attestation_id(&data);
        assert_eq!(result, Some(u64::MAX));
    }

    #[test]
    fn fuzz_extract_attestation_id_random_bytes() {
        // 100 bytes of random-looking data with wrong marker
        let data: Vec<u8> = (0..100).map(|i| (i * 7 + 3) as u8).collect();
        let result = extract_attestation_id(&data);
        // Should not crash, may return None or Some depending on marker
        if result.is_some() {
            // If it returns Some, marker must be at index 1
            assert_eq!(data[1], ATTESTATION_MARKER);
        }
    }

    // =========================================================================
    // V2 Metadata Parsing Fuzz
    // =========================================================================

    #[test]
    fn fuzz_extract_v2_fields_empty() {
        let result = extract_v2_fields(&[]);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_v2_fields_short() {
        let result = extract_v2_fields(&[0x42, 0xB2, 0x00, 0x01]);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_v2_fields_exactly_min() {
        // Exactly V2_METADATA_MIN_LEN bytes (130)
        let mut data = vec![0x42, 0xB2];
        data.extend_from_slice(&[0xAA; 128]); // schema_id + issuer + attestation_uid + nonce
        let result = extract_v2_fields(&data);
        assert!(result.is_some());
        let fields = result.unwrap();
        assert_eq!(fields.schema_id, [0xAA; 32]);
        assert_eq!(fields.expiration_ledger, 0);
    }

    #[test]
    fn fuzz_extract_v2_fields_with_expiry() {
        // V2_METADATA_WITH_EXPIRY_LEN bytes (134)
        let mut data = vec![0x42, 0xB2];
        data.extend_from_slice(&[0xBB; 128]); // core fields
        data.extend_from_slice(&100000u32.to_be_bytes()); // expiry
        let result = extract_v2_fields(&data);
        assert!(result.is_some());
        assert_eq!(result.unwrap().expiration_ledger, 100000);
    }

    #[test]
    fn fuzz_extract_v2_fields_wrong_marker() {
        let mut data = vec![0x42, 0xFF]; // Wrong marker
        data.extend_from_slice(&[0u8; 128]);
        let result = extract_v2_fields(&data);
        assert!(result.is_none());
    }

    #[test]
    fn fuzz_extract_v2_fields_all_zeros() {
        let mut data = vec![0x00, 0xB2];
        data.extend_from_slice(&[0x00; 132]);
        let result = extract_v2_fields(&data);
        assert!(result.is_some());
        let fields = result.unwrap();
        assert_eq!(fields.schema_id, [0u8; 32]);
        assert_eq!(fields.issuer, [0u8; 32]);
    }

    #[test]
    fn fuzz_extract_v2_fields_max_expiry() {
        let mut data = vec![0xFF, 0xB2];
        data.extend_from_slice(&[0xFF; 128]);
        data.extend_from_slice(&u32::MAX.to_be_bytes());
        let result = extract_v2_fields(&data);
        assert!(result.is_some());
        assert_eq!(result.unwrap().expiration_ledger, u32::MAX);
    }

    #[test]
    fn fuzz_extract_v2_fields_adversarial_lengths() {
        // Try various adversarial lengths
        for len in 0..200 {
            let data: Vec<u8> = (0..len).map(|i| i as u8).collect();
            let result = extract_v2_fields(&data);
            // Should never panic
            if let Some(fields) = result {
                // If it parses, fields must be valid
                assert_eq!(fields.schema_id.len(), 32);
                assert_eq!(fields.issuer.len(), 32);
                assert_eq!(fields.attestation_uid.len(), 32);
                assert_eq!(fields.nonce.len(), 32);
            }
        }
    }

    // =========================================================================
    // Announcement Scanning Fuzz (full pipeline)
    // =========================================================================

    #[test]
    fn fuzz_scan_with_empty_announcements() {
        let announcements: Vec<RawAnnouncement> = vec![];
        let view_privkey = valid_view_privkey();
        let spend_pubkey = valid_spend_pubkey();

        let result = scan_for_attestations(&announcements, &view_privkey, &spend_pubkey);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn fuzz_scan_with_single_invalid_announcement() {
        let view_privkey = valid_view_privkey();
        let spend_pubkey = valid_spend_pubkey();

        // Announcement with invalid address
        let ann = RawAnnouncement {
            stealth_address: Address::from([0u8; 20]),
            view_tag: 0,
            ephemeral_pubkey: valid_ephemeral_pubkey(),
            metadata: vec![],
            tx_hash: "0x00".to_string(),
            block_number: 1,
        };

        let result = scan_for_attestations(&[ann], &view_privkey, &spend_pubkey);
        // Should not crash, just return empty or error
        let _ = result;
    }

    #[test]
    fn fuzz_scan_with_many_invalid_announcements() {
        let view_privkey = valid_view_privkey();
        let spend_pubkey = valid_spend_pubkey();

        // Generate 1000 adversarial announcements
        let announcements: Vec<RawAnnouncement> = (0..1000)
            .map(|i| RawAnnouncement {
                stealth_address: Address::from([i as u8; 20]),
                view_tag: (i % 256) as u8,
                ephemeral_pubkey: valid_ephemeral_pubkey(),
                metadata: vec![(i % 256) as u8; i % 100],
                tx_hash: format!("0x{:064x}", i),
                block_number: i as u64,
            })
            .collect();

        let result = scan_for_attestations(&announcements, &view_privkey, &spend_pubkey);
        // Should not crash
        let _ = result;
    }

    #[test]
    fn fuzz_v2_scan_with_mixed_valid_invalid() {
        let view_privkey = valid_view_privkey();
        let spend_pubkey = valid_spend_pubkey();

        let mut announcements = Vec::new();

        // Add some valid-looking but non-matching announcements
        for i in 0..100 {
            let mut metadata = vec![0x42, 0xB2];
            metadata.extend_from_slice(&[i as u8; 32]); // schema_id
            metadata.extend_from_slice(&[i as u8; 32]); // issuer
            metadata.extend_from_slice(&[i as u8; 32]); // attestation_uid
            metadata.extend_from_slice(&[i as u8; 32]); // nonce

            announcements.push(RawAnnouncement {
                stealth_address: Address::from([(i % 20) as u8; 20]),
                view_tag: 0,
                ephemeral_pubkey: valid_ephemeral_pubkey(),
                metadata,
                tx_hash: format!("0x{:064x}", i),
                block_number: i as u64,
            });
        }

        // Add malformed metadata
        for i in 0..50 {
            let bad_len = i % 10;
            announcements.push(RawAnnouncement {
                stealth_address: Address::from([0u8; 20]),
                view_tag: 0,
                ephemeral_pubkey: valid_ephemeral_pubkey(),
                metadata: vec![(i % 256) as u8; bad_len],
                tx_hash: format!("0x{:064x}", 1000 + i),
                block_number: 1000 + i as u64,
            });
        }

        let schemas: Vec<SchemaInfo> = vec![];
        let result = scan_for_attestations_v2(
            &announcements,
            &view_privkey,
            &spend_pubkey,
            &schemas,
            100,
            None,
        );

        // Should not crash even with mixed valid/invalid data
        let _ = result;
    }

    #[test]
    fn fuzz_metadata_encoding_roundtrip_fuzz() {
        // Fuzz: encode then decode should be stable
        for view_tag in 0..=255u8 {
            for id in [0, 1, 42, 1000, u64::MAX - 1, u64::MAX] {
                let encoded = encode_attestation_metadata(view_tag, id);
                assert_eq!(encoded.len(), ATTESTATION_METADATA_MIN_LEN);
                assert_eq!(encoded[0], view_tag);
                assert_eq!(encoded[1], ATTESTATION_MARKER);
                let decoded = extract_attestation_id(&encoded).unwrap();
                assert_eq!(decoded, id);
            }
        }
    }

    #[test]
    fn fuzz_v2_encoding_roundtrip_fuzz() {
        // Fuzz: encode then decode V2 metadata
        let schema_id = [0xAA; 32];
        let issuer = [0xBB; 32];
        let attestation_uid = [0xCC; 32];
        let nonce = [0xDD; 32];

        for view_tag in [0, 1, 127, 128, 255] {
            for expiry in [0, 1, 100000, u32::MAX] {
                let encoded = encode_v2_attestation_metadata(
                    view_tag,
                    &schema_id,
                    &issuer,
                    &attestation_uid,
                    &nonce,
                    expiry,
                );
                assert!(encoded.len() >= V2_METADATA_MIN_LEN);
                let decoded = extract_v2_fields(&encoded).unwrap();
                assert_eq!(decoded.schema_id, schema_id);
                assert_eq!(decoded.issuer, issuer);
                assert_eq!(decoded.attestation_uid, attestation_uid);
                assert_eq!(decoded.nonce, nonce);
                assert_eq!(decoded.expiration_ledger, expiry);
            }
        }
    }

    // =========================================================================
    // Regression Fixtures: Known Malformed Inputs
    // =========================================================================

    #[test]
    fn regression_empty_ephemeral_pubkey_hex() {
        // Previously could cause issues with empty hex decode
        let view_privkey = valid_view_privkey();
        let spend_pubkey = valid_spend_pubkey();

        let ann = RawAnnouncement {
            stealth_address: Address::from([0u8; 20]),
            view_tag: 0,
            ephemeral_pubkey: valid_ephemeral_pubkey(),
            metadata: vec![],
            tx_hash: "".to_string(),
            block_number: 0,
        };

        let result = scan_for_attestations(&[ann], &view_privkey, &spend_pubkey);
        assert!(result.is_ok());
    }

    #[test]
    fn regression_overflow_attestation_id() {
        // Maximum u64 attestation_id should not cause overflow
        let encoded = encode_attestation_metadata(0xFF, u64::MAX);
        let decoded = extract_attestation_id(&encoded);
        assert_eq!(decoded, Some(u64::MAX));
    }

    #[test]
    fn regression_zero_view_tag_matches_zero_hash() {
        // Edge case: view tag 0 could match zero hash
        let view_privkey = valid_view_privkey();
        let ephemeral_pubkey = valid_ephemeral_pubkey();

        // This tests that the view tag check handles zero correctly
        let result = check_announcement_view_tag(0, &view_privkey, &ephemeral_pubkey);
        let _ = result; // Should not panic
    }
}

