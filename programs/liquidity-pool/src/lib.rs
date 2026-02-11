#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use state::*;

declare_id!("66QfMnfGSM2YruCSoXzAVyeS7VRRBNW5jn6PjDFdaZU");



#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub treasury: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
}

#[event]
pub struct LiquidityAdded {
    pub pool: Pubkey,
    pub treasury: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
}

#[event]
pub struct PoolLocked {
    pub pool: Pubkey,
    pub treasury: Pubkey,
}



#[derive(Accounts)]
#[instruction(treasury: Pubkey)]
pub struct CreatePool<'info> {
  
    #[account(mut)]
    pub treasury_signer: Signer<'info>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    /// Pool PDA
    #[account(
        init,
        payer = treasury_signer,
        space = Pool::space(),
        seeds = [SEED_POOL, treasury.as_ref(), mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    /// Vault A: authority MUST be pool PDA
    #[account(
        init,
        payer = treasury_signer,
        token::mint = mint_a,
        token::authority = pool,
        seeds = [SEED_VAULT_A, pool.key().as_ref()],
        bump
    )]
    pub vault_a: Account<'info, TokenAccount>,

    /// Vault B: authority MUST be pool PDA
    #[account(
        init,
        payer = treasury_signer,
        token::mint = mint_b,
        token::authority = pool,
        seeds = [SEED_VAULT_B, pool.key().as_ref()],
        bump
    )]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub treasury_signer: Signer<'info>,

    #[account(
        mut,
        constraint = pool.treasury == treasury_signer.key() @ PoolError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_ata_a.owner == treasury_signer.key() @ PoolError::Unauthorized,
        constraint = user_ata_a.mint == mint_a.key() @ PoolError::MintMismatch
    )]
    pub user_ata_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_ata_b.owner == treasury_signer.key() @ PoolError::Unauthorized,
        constraint = user_ata_b.mint == mint_b.key() @ PoolError::MintMismatch
    )]
    pub user_ata_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_a.key() == pool.vault_a @ PoolError::VaultMismatch
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_b.key() == pool.vault_b @ PoolError::VaultMismatch
    )]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct LockPool<'info> {
    pub treasury_signer: Signer<'info>,

    #[account(
        mut,
        constraint = pool.treasury == treasury_signer.key() @ PoolError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,
}



#[program]
pub mod liquidity_pool_contracts {
    use super::*;

    pub fn create_pool(ctx: Context<CreatePool>, treasury: Pubkey) -> Result<()> {
        instructions::create_pool::handler(ctx, treasury)
    }

    pub fn add_initial_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        instructions::add_liquidity::handler(ctx, amount_a, amount_b)
    }

    pub fn lock_pool(ctx: Context<LockPool>) -> Result<()> {
        instructions::lock_pool::handler(ctx)
    }
}
