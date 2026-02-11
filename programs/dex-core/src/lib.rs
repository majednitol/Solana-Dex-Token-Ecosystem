#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{Mint, Token, TokenAccount};

pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

pub use errors::*;
pub use math::*;
pub use state::*;

declare_id!("4painv7gS8pjTE7iBG8ew1mSPwAX5z7ZKtH7PG3RaaMi"); 


// Events
#[event]
pub struct PairInitialized {
    pub pair: Pubkey,
    pub treasury: Pubkey,
    pub mint_knite: Pubkey,
    pub mint_sub: Pubkey,
    pub vault_knite: Pubkey,
    pub vault_sub: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct SwapExecuted {
    pub pair: Pubkey,
    pub user: Pubkey,
    pub mint_in: Pubkey,
    pub mint_out: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee_knite: u64,
}



#[derive(Accounts)]
#[instruction(treasury: Pubkey)]
pub struct InitializePair<'info> {
    #[account(mut)]
    pub treasury_signer: Signer<'info>,

    pub mint_knite: Account<'info, Mint>,
    pub mint_sub: Account<'info, Mint>,

    #[account(
        init,
        payer = treasury_signer,
        space = Pair::space(),
        seeds = [SEED_PAIR, treasury.as_ref(), mint_knite.key().as_ref(), mint_sub.key().as_ref()],
        bump
    )]
    pub pair: Account<'info, Pair>,

    /// Dex vaults are created here and OWNED by Pair PDA (authority = pair PDA).
    #[account(
        init,
        payer = treasury_signer,
        token::mint = mint_knite,
        token::authority = pair,
        seeds = [SEED_VAULT_KNITE, pair.key().as_ref()],
        bump
    )]
    pub vault_knite: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = treasury_signer,
        token::mint = mint_sub,
        token::authority = pair,
        seeds = [SEED_VAULT_SUB, pair.key().as_ref()],
        bump
    )]
    pub vault_sub: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SwapExactIn<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint_in: Account<'info, Mint>,
    pub mint_out: Account<'info, Mint>,

    #[account(
        seeds = [SEED_PAIR, pair.treasury.as_ref(), pair.mint_knite.as_ref(), pair.mint_sub.as_ref()],
        bump = pair.bump
    )]
    pub pair: Account<'info, Pair>,


    #[account(
        mut,
        constraint = user_ata_in.owner == user.key() @ DexError::Unauthorized,
        constraint = user_ata_in.mint == mint_in.key() @ DexError::MintMismatch
    )]
    pub user_ata_in: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_ata_out.owner == user.key() @ DexError::Unauthorized,
        constraint = user_ata_out.mint == mint_out.key() @ DexError::MintMismatch
    )]
    pub user_ata_out: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault_knite.key() == pair.vault_knite @ DexError::MintMismatch,
        constraint = vault_knite.mint == pair.mint_knite @ DexError::MintMismatch,
        constraint = vault_knite.owner == pair.key() @ DexError::Unauthorized
    )]
    pub vault_knite: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault_sub.key() == pair.vault_sub @ DexError::MintMismatch,
        constraint = vault_sub.mint == pair.mint_sub @ DexError::MintMismatch,
        constraint = vault_sub.owner == pair.key() @ DexError::Unauthorized
    )]
    pub vault_sub: Box<Account<'info, TokenAccount>>,

    /// Treasury kNite ATA (strictly validated in handler)
    #[account(
        mut,
        constraint = treasury_knite_ata.mint == pair.mint_knite @ DexError::MintMismatch
    )]
    pub treasury_knite_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}



#[program]
pub mod dex_core_contracts {
    use super::*;

    pub fn initialize_pair(ctx: Context<InitializePair>, treasury: Pubkey) -> Result<()> {
        instructions::initialize_pair::handler(ctx, treasury)
    }

    pub fn swap_exact_in(ctx: Context<SwapExactIn>, amount_in: u64, min_out: u64) -> Result<()> {
        instructions::swap::handler(ctx, amount_in, min_out)
    }
}



pub fn assert_treasury_knite_ata(pair: &Pair, treasury_knite_ata: Pubkey) -> Result<()> {
    let expected = get_associated_token_address(&pair.treasury, &pair.mint_knite);
    if expected != treasury_knite_ata {
        return err!(DexError::InvalidTreasuryAta);
    }
    Ok(())
}
