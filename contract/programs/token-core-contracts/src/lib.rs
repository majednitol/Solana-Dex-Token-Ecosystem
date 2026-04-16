#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod state;

pub use errors::*;
pub use state::*;

declare_id!("GdWoikJDEhSmFMSPLZZAjnPFr67XtRni5KcyP3BCg5DV");

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = TokenRegistry::space(),
        seeds = [SEED_TOKEN_REGISTRY],
        bump
    )]
    pub registry: Account<'info, TokenRegistry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterMint<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TOKEN_REGISTRY],
        bump = registry.bump
    )]
    pub registry: Account<'info, TokenRegistry>,
}

#[program]
pub mod token_core_contracts {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>, authority: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            authority,
            TokenCoreError::Unauthorized
        );

        let reg = &mut ctx.accounts.registry;
        reg.bump = ctx.bumps.registry;
        reg.authority = authority;
        reg.count = 0;
        reg.mints = [Pubkey::default(); MAX_TOKENS];
        Ok(())
    }

    pub fn register_mint(ctx: Context<RegisterMint>, mint: Pubkey) -> Result<()> {
        let reg = &mut ctx.accounts.registry;

        require_keys_eq!(
            reg.authority,
            ctx.accounts.authority.key(),
            TokenCoreError::Unauthorized
        );

        let existing = reg.mints[..reg.count as usize].iter().any(|m| *m == mint);
        if existing {
            return Ok(());
        }

        let idx = reg.count as usize;
        if idx >= MAX_TOKENS {
            return err!(TokenCoreError::InvalidAmount);
        }

        reg.mints[idx] = mint;
        reg.count = reg
            .count
            .checked_add(1)
            .ok_or_else(|| error!(TokenCoreError::MathOverflow))?;

        Ok(())
    }
}
