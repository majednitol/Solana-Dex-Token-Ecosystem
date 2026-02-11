#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use state::*;

declare_id!("3kjLEqxPh5v3U5hmrzfYgLHfAXbvErimhMMu5Lz43k4f");


#[event]
pub struct TaxCollected {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub treasury: Pubkey,
    pub treasury_ata: Pubkey,
    pub amount: u64,
    pub tax_bps: u16,
}

#[event]
pub struct TransferNet {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}



#[derive(Accounts)]
#[instruction(decimals: u8, fixed_supply: u64, treasury: Pubkey)]
pub struct InitializeMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// New mint (created by this instruction)
    #[account(
        init,
        payer = payer,
        mint::decimals = decimals,
        mint::authority = payer,
       
        mint::freeze_authority = payer
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: recipient wallet (ATA authority)
    pub initial_recipient_owner: UncheckedAccount<'info>,

    /// Recipient ATA (created if needed)
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = initial_recipient_owner
    )]
    pub initial_recipient_ata: Account<'info, TokenAccount>,

    /// CHECK: treasury wallet account (must match `treasury` arg in handler)
    pub treasury_account: UncheckedAccount<'info>,

    /// Treasury ATA (created if needed)
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = treasury_account
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    /// Config PDA per mint
    #[account(
        init,
        payer = payer,
        space = TokenConfig::space(),
        seeds = [SEED_TOKEN_CONFIG, mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, TokenConfig>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferWithTax<'info> {
    pub from_owner: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [SEED_TOKEN_CONFIG, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.mint == mint.key() @ TokenCoreError::MintMismatch
    )]
    pub config: Account<'info, TokenConfig>,

    #[account(
        mut,
        constraint = from_ata.owner == from_owner.key() @ TokenCoreError::Unauthorized,
        constraint = from_ata.mint == mint.key() @ TokenCoreError::MintMismatch
    )]
    pub from_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = to_ata.mint == mint.key() @ TokenCoreError::MintMismatch
    )]
    pub to_ata: Account<'info, TokenAccount>,

    /// Treasury ATA for this mint (validated strictly in handler as ATA(treasury, mint))
    #[account(
        mut,
        constraint = treasury_ata.mint == mint.key() @ TokenCoreError::MintMismatch
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RenounceMintAuthority<'info> {
    /// Only treasury is allowed to trigger renounce
    pub treasury_signer: Signer<'info>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [SEED_TOKEN_CONFIG, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.mint == mint.key() @ TokenCoreError::MintMismatch
    )]
    pub config: Account<'info, TokenConfig>,

    pub token_program: Program<'info, Token>,
}



#[program]
pub mod token_core_contracts {
    use super::*;

    pub fn initialize_mint(
        ctx: Context<InitializeMint>,
        decimals: u8,
        fixed_supply: u64,
        treasury: Pubkey,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, decimals, fixed_supply, treasury)
    }

    pub fn transfer_with_tax(ctx: Context<TransferWithTax>, amount: u64) -> Result<()> {
        instructions::transfer::handler(ctx, amount)
    }

    pub fn renounce_mint_authority(ctx: Context<RenounceMintAuthority>) -> Result<()> {
        instructions::renounce_authority::handler(ctx)
    }
}
