# Relayer Operator Threat Model

Relayers submit privacy pool withdrawals on behalf of users. Unlike wallet users who use the protocol for privacy, relayer operators run a service with distinct threats to their operational security, reputation, and legal standing.

## What is protected

Relayer operators can:
- Register anonymously (operator address not linked to a real identity)
- Earn fees without requiring personal information
- Operate across jurisdictions without centralized KYC
- Bid on jobs without revealing infrastructure details

The protocol does NOT protect relayer operators against:
- Legal pressure from regulators or authorities
- Attacks that target relayer infrastructure (DDoS, network partitioning)
- Social engineering or supply chain attacks
- Deanonymization techniques that combine on-chain and off-chain data

## Residual risks

### 1. Key theft

An attacker gaining access to the relayer's X25519 private key (stored in the relayer process) can impersonate the relayer:
- Decrypt job payloads meant for the legitimate operator
- Submit transactions with the legitimate relayer's stake backing them
- Earn fees on behalf of the attacker

**Impact:** Total loss of incoming jobs and fees during the compromise window.

**Mitigation:**
- Store X25519 private keys in a hardware security module (HSM) or encrypted key management service
- Rotate keys regularly and monitor for unauthorized key usage
- Use separate relayer operator accounts for high-value deployments
- Implement key backup and recovery procedures tested offline

### 2. Griefing attacks (job exhaustion)

A user can create many escrowed jobs in the relayer registry and advertise them to the gateway without the intent to pay. A relayer operator wastes resources:
- Processing invalid or malformed job advertisements
- Validating on-chain job state repeatedly
- Networking overhead from large job batches

If the relayer cannot handle the load, legitimate users' withdrawals are delayed.

**Impact:** Degraded service availability, reputation damage if withdrawals timeout.

**Mitigation:**
- Rate-limit job advertisement processing per wallet address
- Implement adaptive backpressure: shed low-value or suspicious jobs under load
- Cache on-chain job state to reduce redundant queries
- Monitor job-to-bid ratios and alert on suspicious patterns
- Consider reputation scoring: prioritize wallets with historical follow-through

### 3. Deanonymization pressure

Authorities or organized groups may pressure relayer operators to:
- Log transaction metadata (sender, recipient, amounts)
- Reveal IP addresses of connected wallets
- Censor specific users or transactions
- Cooperate with surveillance programs

**Impact:** Loss of operator anonymity, forced identification, potential legal liability.

**Mitigation:**
- Minimize data retention: log only technical metrics (uptime, latency) not transaction metadata
- Operate the relayer from a jurisdiction with legal privacy protections
- Use privacy-enhancing network infrastructure (Tor, VPN, or decentralized hosting)
- Implement automated log rotation and purging to avoid retroactive disclosure
- Use encrypted channels (TLS 1.3+) to the gateway; consider extra-protocol anonymization
- Document your privacy practices publicly; consider a transparency report template

### 4. Legal exposure

Relayer operators may face regulatory claims that they:
- Are facilitating money laundering or sanctions evasion
- Are operating as an unlicensed money transmitter
- Are providing services to jurisdictions under embargo

**Impact:** Operator prosecution, asset seizure, business shutdown.

**Mitigation:**
- Obtain legal counsel in your jurisdiction before operating
- Implement basic controls: do not explicitly know user identities, do not verify AML/KYC
- Understand your local regulations on privacy protocols and intermediary liability
- Consider operating from a jurisdiction with legal clarity on privacy tools
- Maintain audit trails of your technical policies (not transaction logs)
- Document the architectural design: relayer cannot change recipient, amount, or proof

### 5. Operator reputation attacks

A malicious gateway operator or user can:
- Publish false bids in the relayer's name (if the relayer's public key is compromised)
- Claim the relayer submitted invalid transactions
- Attribute failed withdrawals to the relayer's service

**Impact:** Loss of user trust, reduced job flow, revenue decline.

**Mitigation:**
- Ensure bids are cryptographically signed; the relayer's signature proves authorship
- Monitor for impersonation attempts; verify bids against your registered endpoint
- Maintain detailed logs of submission attempts and outcomes
- Establish a public channel (governance or forum) to address false claims
- Use time-series monitoring to detect anomalies in job patterns

### 6. Fee unpredictability and MEV

A relayer may:
- Underestimate submission costs and operate at a loss
- Lose fee margin to transaction fee volatility (during network congestion)
- Compete with MEV-aware wallets that deliberately overpay to secure relayer priority

**Impact:** Eroded margins, potential bankruptcy of unhedged operators.

**Mitigation:**
- Monitor Horizon fee trends and adjust minimum bid amounts regularly
- Implement a dynamic fee model: set bids as a multiple of current network fees plus a margin
- Consider hedging strategies: batch jobs and submit during low-fee windows
- Track win rate per job tier; exit unprofitable segments
- Build reputation: consistent, fast submission attracts premium-paying wallets

### 7. Dependency and endpoint failures

The relayer depends on:
- RPC node availability (Horizon, Soroban)
- Gateway connectivity (loss of job advertisements or bid submission)
- Relayer registry contract availability

A single point of failure causes service degradation or complete outage.

**Impact:** User withdrawals blocked, fee loss, reputation damage.

**Mitigation:**
- Run multiple RPC clients; fail over if one becomes unresponsive
- Use multiple gateway endpoints or run your own gateway mirror
- Cache critical contract state (relayer registry) locally with periodic refresh
- Implement circuit breakers: stop accepting new jobs if dependencies are unavailable
- Monitor endpoint health; alert on latency or error rate changes
- Use redundant network paths (multi-datacenter deployment)

## What is NOT protected

The relayer threat model does not cover:
- **User-side attacks:** Compromised wallet extensions, user key theft, or phishing
- **Smart contract vulnerabilities:** Bugs in privacy pool, relayer registry, or verifier contracts
- **Cryptographic breaks:** If Groth16 or Poseidon are cryptanalyzed
- **Protocol-level attacks:** Proof forging, nullifier collisions, or state corruption
- **ASP attacks:** The ASP can publish bad association-set or state roots (mitigated by client verification)

See [GHOST_THREAT_MODEL.md](GHOST_THREAT_MODEL.md) for wallet key storage risks.

## Operational security checklist

Before running a relayer in production:

- [ ] X25519 private key stored in an HSM or encrypted KMS
- [ ] Private key rotation policy documented and tested
- [ ] Multiple Horizon and Soroban RPC endpoints configured
- [ ] Rate limiting on job intake implemented
- [ ] Log retention policy set to minimum necessary for operations
- [ ] Endpoint monitoring and alerting configured
- [ ] Legal counsel review of your jurisdiction's regulations
- [ ] TLS 1.3+ enforced on all connections
- [ ] Dynamic fee calculation based on current Horizon fees
- [ ] Regular security audits scheduled
