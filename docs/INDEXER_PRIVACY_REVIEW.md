# Indexer Privacy Review

## Overview

This document reviews the privacy implications of the Attestation State Provider (ASP) indexer and the data that operators and observers can access.

## What Operators Can Observe

### Network Level
- **RPC endpoint observations:** When an operator runs an indexer with a custom RPC provider, they can observe:
  - All RPC queries made by the indexer (method names, parameters, timestamps)
  - Transaction submission patterns and timing
  - Network requests to fetch ledger state
  - Metadata like X-Forwarded-For headers if proxied

- **Blockchain observations:** All operators can see:
  - On-chain attestation state (stored in the smart contract storage)
  - All attestations published to the contract (immutable, public by design)
  - Pool state and updates (published Merkle roots, accumulated state)

### ASP Indexer Data Access
- The ASP indexer has access to:
  - All stealth meta-addresses published on-chain (public contract data)
  - All attestations and announcements (public contract events)
  - Ephemeral public keys associated with announcements
  - Transaction metadata (gas costs, execution status, timestamps)

### What Operators Cannot Access
- **Private keys:** The indexer never handles user private keys
- **User identity:** No mapping between addresses and real-world identity
- **Detailed transaction content:** The indexer sees only aggregated attestation state
- **Stealth address derivations:** Scanner derivations happen client-side only; operators don't see which addresses are derived or by whom

## Privacy Guarantees and Limitations

### Guaranteed Properties
1. **No credential exposure:** Private keys never transmitted to or stored by the indexer
2. **Client-side derivation:** Stealth address derivation is performed entirely in the browser via WASM; operators cannot infer which announcements a user has matched
3. **Unlinkability:** Without additional out-of-band information, operators cannot link users across multiple stealth addresses

### Operational Risks
1. **Query pattern analysis:** An operator observing RPC queries in real-time could infer:
   - When the indexer is scanning for new attestations (timing patterns)
   - Which Merkle roots are being processed (ledger query patterns)
   - Frequency of indexer updates

2. **IP-based correlation:** If a user runs their own indexer or uses a public one, their IP address is logged by the RPC provider and could be correlated with their wallet if other data sources are available

3. **Sybil resistance limitations:** Operators can only assume:
   - Stealth meta-addresses are legitimately unique (not cryptographically enforced)
   - Announcements are authentic (verified by scanner on retrieval)

## Mitigation Strategies

### For Users
- **Use a trusted RPC provider** or operate your own to avoid operator correlation attacks
- **Isolate browser profiles** for high-value operations to prevent cross-site tracking
- **Use VPNs or Tor** when querying public RPC providers to reduce IP-based correlation risk
- **Rotate stealth meta-addresses** periodically to minimize long-term tracking windows

### For Operators
- **Minimize logging:** ASP indexers should log only essential operational events:
  - Approved attestation counts (aggregated)
  - Sync status and timing (not user-specific)
  - Error conditions (without sensitive details)

- **Exclude sensitive data from logs:**
  - No raw stealth meta-addresses
  - No individual announcement data
  - No user-identifying information
  - No SQL/RPC query contents

- **Rotate logs** regularly to limit historical data retention
- **Restrict log access** to authorized operators only

### For Integrators
- **Disclose operator capabilities:** When integrating ASP, inform users:
  - "Your indexer operator can observe the timing and volume of your queries"
  - "Use a trusted RPC provider; public RPC operators can correlate your IP with your activities"
  - "Stealth address derivation happens entirely on your device; operators cannot see your derived addresses"

- **Offer audit logs:** Allow users to verify which announcements their stealth meta-addresses matched
- **Support multiple indexer options:** Let users choose between public, community-run, or self-hosted indexers

## Audit Checklist

- [ ] Indexer logs exclude raw stealth meta-addresses
- [ ] No user private data in error messages or debug logs
- [ ] RPC query parameters are not logged in full (log method name only)
- [ ] Operator documentation explains privacy model clearly
- [ ] User-facing docs include guidance on trusted provider selection
- [ ] All third-party data processors (RPC, logging services) are listed
- [ ] Data retention policies are documented for log files

## Current Implementation Notes

The current ASP indexer implementation includes safeguards:
- No raw meta-addresses logged (aggregated counts only)
- RPC queries are minimal and filtered
- Error logs contain only error messages, not full request/response data
- No persistent logging of individual attestations or stealth addresses

## Future Enhancements

1. **Stateless indexing:** Allow users to run indexers without persistent state, reducing correlation risk
2. **Private indexer network:** Support indexer federation with privacy-preserving aggregation
3. **Batch query privacy:** Implement private information retrieval (PIR) techniques to hide query patterns from RPC operators
4. **Hardware wallets:** Offload key derivation to hardware to prevent browser-based key exposure

