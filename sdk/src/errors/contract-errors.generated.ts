/**
 * Canonical error code mapping for all Soroban contracts.
 *
 * GENERATED FILE — do not edit manually. Run:
 *   npx tsx scripts/generate-error-mapping.ts
 *
 * Source of truth: each contract's `#[contracterror]` enum in Rust.
 * Removing or renumbering a code in the Rust source without updating this
 * file will cause the generate script to fail, keeping SDK and contracts
 * in sync.
 */

export const CONTRACT_ERROR_NAMES: Record<string, Record<number, string>> = {
  "groth16-verifier": {
    1: "InvalidPublicSignal",
    2: "Bn128AdditionFailed",
    3: "Bn128MultiplicationFailed",
    4: "Bn128PairingFailed",
  },
  "privacy-pool": {
    1: "Unauthorized",
    2: "AlreadyInitialized",
    3: "InvalidProof",
    4: "NullifierUsed",
    5: "UnknownStateRoot",
    6: "UnknownAspRoot",
    7: "RootExpired",
    8: "BadAmount",
    9: "IndexMismatch",
    10: "CustodyViolation",
  },
  "reputation-verifier": {
    1: "Unauthorized",
    2: "RootExpired",
    3: "InvalidProof",
    4: "NullifierUsed",
    5: "AlreadyInitialized",
    6: "AttestationExpired",
    7: "InvalidDatasetHash",
  },
  "attestation-engine-v2": {
    1: "DataTooLarge",
    2: "UnauthorizedIssuer",
    3: "ExpirationInPast",
    4: "AttestationNotFound",
    5: "AlreadyRevoked",
    6: "NotRevocable",
    7: "Unauthorized",
    8: "AttestationAlreadyExists",
    9: "NotInitialized",
    10: "AlreadyInitialized",
    11: "Paused",
    12: "InvalidAttestationData",
    13: "SchemaDeprecated",
    14: "SchemaExpired",
    15: "SchemaNotFound",
  },
  "schema-registry": {
    1: "NameTooLong",
    2: "FieldDefsTooLong",
    3: "InvalidSchemaId",
    4: "Unauthorized",
    5: "DelegateLimitReached",
    6: "DelegateAlreadyExists",
    7: "DelegateNotFound",
    8: "SchemaAlreadyExists",
    9: "InvalidExpiryLedger",
    10: "InvalidFieldDefs",
    11: "EmptyFieldDefs",
    12: "TooManyFields",
    13: "InvalidFieldName",
    14: "InvalidFieldType",
    15: "DuplicateFieldName",
    16: "MalformedFieldSegment",
  },
  "relayer-registry": {
    1: "Unauthorized",
    2: "AlreadyInitialized",
    3: "NotInitialized",
    4: "RelayerExists",
    5: "RelayerMissing",
    6: "StakeTooLow",
    7: "BadAmount",
    8: "InsufficientFreeStake",
    9: "UnstakeLocked",
    10: "JobExists",
    11: "JobMissing",
    12: "BadDeadline",
    13: "JobNotOpen",
    14: "JobNotAccepted",
    15: "WrongRelayer",
    16: "DeadlinePassed",
    17: "DeadlineNotPassed",
    18: "PayloadHashMismatch",
    19: "AlreadyFinalized",
  },
  "stealth-announcer": {
    1: "InvalidEphemeralKey",
    2: "MetadataMissingViewTag",
    3: "InvalidKeyPrefix",
    4: "UnsupportedSchemeId",
    5: "InvalidStealthAddressLength",
    6: "InvalidStealthAddressEncoding",
    7: "DuplicateLogId",
  },
  "stealth-registry": {
    1: "InvalidMetaAddress",
    2: "InvalidPrefix",
    3: "SameKeys",
  },
};
