use anchor_lang::prelude::*;

use crate::{CreatePool, PoolCreated};
use crate::errors::PoolError;

pub fn handler(ctx: Context<CreatePool>, treasury: Pubkey) -> Result<()> {
    // treasury signer must match instruction arg
    if ctx.accounts.treasury_signer.key() != treasury {
        return err!(PoolError::Unauthorized);
    }

    if ctx.accounts.mint_a.key() == ctx.accounts.mint_b.key() {
        return err!(PoolError::SameMint);
    }

    let pool = &mut ctx.accounts.pool;

  
    pool.bump = ctx.bumps.pool;
    pool.vault_a_bump = ctx.bumps.vault_a;
    pool.vault_b_bump = ctx.bumps.vault_b;

    pool.treasury = treasury;

    pool.mint_a = ctx.accounts.mint_a.key();
    pool.mint_b = ctx.accounts.mint_b.key();

    pool.vault_a = ctx.accounts.vault_a.key();
    pool.vault_b = ctx.accounts.vault_b.key();

   
    if ctx.accounts.vault_a.mint != pool.mint_a || ctx.accounts.vault_b.mint != pool.mint_b {
        return err!(PoolError::MintMismatch);
    }

    //  vault authority must be pool PDA (TokenAccount.owner == authority pubkey)
    if ctx.accounts.vault_a.owner != pool.key() || ctx.accounts.vault_b.owner != pool.key() {
        return err!(PoolError::InvalidVaultAuthority);
    }

    pool.locked = false;
    pool.total_a = 0;
    pool.total_b = 0;

    emit!(PoolCreated {
        pool: pool.key(),
        treasury,
        mint_a: pool.mint_a,
        mint_b: pool.mint_b,
        vault_a: pool.vault_a,
        vault_b: pool.vault_b,
    });

    Ok(())
}
