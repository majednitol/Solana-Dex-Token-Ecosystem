use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::{AddLiquidity, LiquidityAdded};
use crate::errors::PoolError;

pub fn handler(ctx: Context<AddLiquidity>, amount_a: u64, amount_b: u64) -> Result<()> {
    if amount_a == 0 || amount_b == 0 {
        return err!(PoolError::InvalidAmount);
    }

    let pool = &mut ctx.accounts.pool;

    // treasury signer must match pool.treasury (defense in depth; also constrained in Accounts)
    if ctx.accounts.treasury_signer.key() != pool.treasury {
        return err!(PoolError::Unauthorized);
    }

    // forbid adds after lock 
    if pool.locked {
        return err!(PoolError::PoolAlreadyLocked);
    }

    // Ensure passed mints match pool config
    if ctx.accounts.mint_a.key() != pool.mint_a || ctx.accounts.mint_b.key() != pool.mint_b {
        return err!(PoolError::MintMismatch);
    }

    // Ensure passed vaults match pool state
    if ctx.accounts.vault_a.key() != pool.vault_a || ctx.accounts.vault_b.key() != pool.vault_b {
        return err!(PoolError::VaultMismatch);
    }

    // Vault mint + authority safety
    if ctx.accounts.vault_a.mint != pool.mint_a || ctx.accounts.vault_b.mint != pool.mint_b {
        return err!(PoolError::MintMismatch);
    }
    if ctx.accounts.vault_a.owner != pool.key() || ctx.accounts.vault_b.owner != pool.key() {
        return err!(PoolError::InvalidVaultAuthority);
    }

    // Transfer A from treasury ATA -> vault A
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ata_a.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.treasury_signer.to_account_info(),
            },
        ),
        amount_a,
    )?;

    // Transfer B from treasury ATA -> vault B
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ata_b.to_account_info(),
                to: ctx.accounts.vault_b.to_account_info(),
                authority: ctx.accounts.treasury_signer.to_account_info(),
            },
        ),
        amount_b,
    )?;

    pool.total_a = pool
        .total_a
        .checked_add(amount_a)
        .ok_or_else(|| error!(PoolError::MathOverflow))?;

    pool.total_b = pool
        .total_b
        .checked_add(amount_b)
        .ok_or_else(|| error!(PoolError::MathOverflow))?;

    emit!(LiquidityAdded {
        pool: pool.key(),
        treasury: pool.treasury,
        amount_a,
        amount_b,
    });

    Ok(())
}
