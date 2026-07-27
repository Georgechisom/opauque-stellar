# Relayer Operator Economics

This document describes the economic model for running a relayer node in the Opaque privacy-pool system. Prospective operators can use this to evaluate whether running a node is worthwhile.

## Overview

Relayers earn fees by submitting privacy-pool withdrawal transactions on behalf of users. In exchange, they must bond stake as collateral to guarantee honest behavior. The registry contract enforces slashing for misbehavior and an unbonding period before stake withdrawal.

## Stake Requirements

### Minimum Stake

| Parameter | Value | Source |
| --- | --- | --- |
| `minimum_stake` | 0.1 XLM (1,000,000 stroops) | `relayer-registry` `DEFAULT_MINIMUM_STAKE` |

The minimum stake is set at contract initialization and can be updated by the admin via `set_config`. See `contracts/relayer-registry/src/lib.rs:18`.

### Free Stake vs Bonded Stake

- **Free stake**: Available for bidding on new jobs. Must be ≥ the job fee.
- **Bonded stake**: Locked as collateral when a job is accepted. Released on successful submission or returned after slashing.

### Stake Operations

| Operation | Function | Notes |
| --- | --- | --- |
| Add stake | `add_stake` | Increases free stake immediately |
| Request unstake | `request_unstake` | Moves free stake to pending; starts unbonding cooldown |
| Withdraw stake | `withdraw_stake` | Releases pending stake after cooldown expires |

## Fee Flow

1. **User creates job**: Escrows `fee` into the registry contract.
2. **Relayer accepts job**: Bonds `fee` from free stake.
3. **Relayer submits withdrawal**: Registry calls `privacy_pool.withdraw`, releases bonded stake back to free stake, and transfers `fee` to the relayer.

### Fee Constraints

- `fee` must be > 0
- Relayer's `free_stake` must be ≥ `fee` at bid time
- The relayer should ensure `fee` covers transaction costs plus profit margin

## Slashing Exposure

Slashing occurs when a relayer accepts a job but fails to submit before the deadline.

### Slashing Mechanics

| Event | Outcome |
| --- | --- |
| Job accepted, deadline passes, not submitted | Creator calls `slash_job` |
| Slashed amount | `fee` from bonded stake |
| Payout to creator | `fee * 2` (double the fee as penalty) |
| During unbonding | Slashing reduces `pending_unstake` proportionally |

### Slashing During Unbonding

If a relayer has a pending unstake and gets slashed, the slashed amount is deducted from `pending_unstake` first. If the slash fully covers the pending amount, `unstake_unlock_ledger` is reset to 0.

## Unbonding Period

| Parameter | Value | Source |
| --- | --- | --- |
| `unstake_cooldown_ledgers` | 720 (~1 hour at 5s/ledger) | `DEFAULT_UNSTAKE_COOLDOWN_LEDGERS` |

After requesting unstake, the relayer must wait the cooldown period before withdrawing. During this window, slashing remains possible.

## Worked Example: Operator Margin on Testnet

### Assumptions

- Relayer stakes 10 XLM (10,000,000 stroops)
- Average job fee: 0.01 XLM (100,000 stroops)
- Transaction fee: ~0.0001 XLM per submission
- Jobs per day: 50
- Slashing rate: 0% (honest operator)

### Revenue

```
Daily revenue = 50 jobs × 0.01 XLM = 0.5 XLM/day
Monthly revenue = 0.5 × 30 = 15 XLM
```

### Costs

```
Transaction fees = 50 × 0.0001 = 0.005 XLM/day
Monthly costs = 0.005 × 30 = 0.15 XLM
```

### Margin

```
Daily profit = 0.5 - 0.005 = 0.495 XLM
Monthly profit = 15 - 0.15 = 14.85 XLM
Margin = 14.85 / 15 = 99%
```

### Break-Even

With 10 XLM staked and 0.01 XLM per job, the operator breaks even on stake opportunity cost after accumulating enough profit to offset the locked capital. At 50 jobs/day, this takes approximately 20 days.

### Risk Adjusted Margin

If slashing occurs (e.g., 1 in 100 jobs slashed):

```
Slashing loss per event = 0.01 XLM × 2 = 0.02 XLM
Expected daily slashing cost = 0.5 × 0.02 = 0.01 XLM
Adjusted monthly profit = 14.85 - (0.01 × 30) = 14.55 XLM
Adjusted margin = 14.55 / 15 = 97%
```

## Cost Summary Table

| Cost Item | Amount | Frequency |
| --- | --- | --- |
| Initial stake | ≥ 0.1 XLM | One-time |
| Transaction fees | ~0.0001 XLM | Per job |
| Slashing penalty | 2× fee | Per slash event |

## Revenue Summary Table

| Revenue Item | Amount | Frequency |
| --- | --- | --- |
| Job fee | Configured per job | Per successful submission |

## Querying On-Chain State

Use the relayer registry contract to query:

- `get_relayer(operator)`: Returns `free_stake`, `bonded_stake`, `pending_unstake`, `unstake_unlock_ledger`
- `get_unbonding_status(operator)`: Returns `(pending_unstake, unlock_ledger, is_unlockable)`
- `get_config()`: Returns `minimum_stake`, `unstake_cooldown_ledgers`, `max_deadline_ledgers`

## Further Reading

- [Running a Relayer](./running-relayer.md)
- [Relayer Threat Model](./RELAYER_THREAT_MODEL.md)
- [Technical Overview](./technical-overview.md)
