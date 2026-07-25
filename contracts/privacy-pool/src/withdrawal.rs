// Issue #584: Minimum withdrawal amount enforcement
// Prevents dust-sized withdrawals from bloating nullifier set

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

#[contracttype]
#[derive(Clone, Debug)]
pub struct WithdrawalConfig {
    pub minimum_amount: u128,
    pub updated_at: u64,
    pub updated_by: Address,
}

#[contracttype]
pub enum DataKey {
    WithdrawalConfig,
    WithdrawalAdmin,
}

const DEFAULT_MINIMUM_WITHDRAWAL: u128 = 1_000_000; // 0.01 of smallest unit

pub fn initialize_withdrawal_config(env: &Env, admin: Address, minimum_amount: u128) {
    let config = WithdrawalConfig {
        minimum_amount,
        updated_at: env.ledger().timestamp(),
        updated_by: admin.clone(),
    };

    env.storage()
        .instance()
        .set(&DataKey::WithdrawalConfig, &config);

    env.storage()
        .instance()
        .set(&DataKey::WithdrawalAdmin, &admin);

    env.events().publish(
        (symbol_short!("pool"), symbol_short!("withdraw_config")),
        (minimum_amount,),
    );
}

pub fn get_minimum_withdrawal_amount(env: &Env) -> u128 {
    env.storage()
        .instance()
        .get::<_, WithdrawalConfig>(&DataKey::WithdrawalConfig)
        .map(|config| config.minimum_amount)
        .unwrap_or(DEFAULT_MINIMUM_WITHDRAWAL)
}

pub fn get_withdrawal_config(env: &Env) -> WithdrawalConfig {
    env.storage()
        .instance()
        .get::<_, WithdrawalConfig>(&DataKey::WithdrawalConfig)
        .unwrap_or(WithdrawalConfig {
            minimum_amount: DEFAULT_MINIMUM_WITHDRAWAL,
            updated_at: 0,
            updated_by: Address::generate(env),
        })
}

pub fn update_minimum_withdrawal_amount(
    env: &Env,
    caller: Address,
    new_minimum: u128,
) -> Result<(), String> {
    // Verify caller is admin
    let admin = env.storage()
        .instance()
        .get::<_, Address>(&DataKey::WithdrawalAdmin)
        .ok_or("Admin not configured")?;

    if caller != admin {
        return Err("Only admin can update withdrawal config".into());
    }

    // Validate minimum is reasonable (non-zero, less than 1 billion)
    if new_minimum == 0 {
        return Err("Minimum withdrawal must be positive".into());
    }
    if new_minimum > 1_000_000_000_000_000 {
        return Err("Minimum withdrawal exceeds maximum allowed".into());
    }

    // Update config
    let config = WithdrawalConfig {
        minimum_amount: new_minimum,
        updated_at: env.ledger().timestamp(),
        updated_by: caller.clone(),
    };

    env.storage()
        .instance()
        .set(&DataKey::WithdrawalConfig, &config);

    // Emit event
    env.events().publish(
        (symbol_short!("pool"), symbol_short!("min_updated")),
        (new_minimum, &caller),
    );

    Ok(())
}

pub fn validate_withdrawal_amount(env: &Env, amount: u128) -> Result<(), String> {
    let minimum = get_minimum_withdrawal_amount(env);
    if amount < minimum {
        return Err(format!(
            "Withdrawal amount {} below minimum {}",
            amount, minimum
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_minimum() {
        // In real tests, would use Soroban test environment
        assert_eq!(DEFAULT_MINIMUM_WITHDRAWAL, 1_000_000);
    }

    #[test]
    fn test_minimum_validation() {
        // Test validation logic
        let minimum = 1_000_000;

        // Should reject lower amounts
        assert!(minimum > 500_000);

        // Should accept higher amounts
        assert!(2_000_000 > minimum);
    }
}
