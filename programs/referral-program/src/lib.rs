#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use state::*;

declare_id!("98cFEKmo2UBbA5h5Sj3gpkHgvTcnUk1XMYDNmuocRQD7"); 


#[event]
pub struct ReferralRecorded {
    pub user: Pubkey,
    pub referrer: Pubkey,
    pub pair: Pubkey,
    pub ts: i64,
}



#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = ReferralConfig::space(),
        seeds = [state::SEED_REFERRAL_CONFIG],
        bump
    )]
    pub config: Account<'info, ReferralConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(referrer: Pubkey, pair: Pubkey)]
pub struct RecordFirstSwap<'info> {
    /// CHECK:
    pub user: UncheckedAccount<'info>,

    /// Marker PDA prevents duplicates
    #[account(
        init,
        payer = payer,
        space = RefereeState::space(),
        seeds = [state::SEED_REFERRAL_MARKER, user.key().as_ref()],
        bump
    )]
    pub referee: Account<'info, RefereeState>,

    /// pays rent for marker account
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK:
    /// dex-core program account, provided by caller.
    /// Safety: We verify (in handler) that:
    ///  - dex_program.key() == config.allowed_dex_program
    ///  - dex_program.executable == true
    pub dex_program: UncheckedAccount<'info>,
    pub treasury_signer: Option<Signer<'info>>,

    #[account(
        seeds = [state::SEED_REFERRAL_CONFIG],
        bump = config.bump
    )]
    pub config: Account<'info, ReferralConfig>,

    pub system_program: Program<'info, System>,
}


#[program]
pub mod referral_program_contracts {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        allowed_dex_program: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, allowed_dex_program, treasury)
    }

    pub fn record_first_swap(
        ctx: Context<RecordFirstSwap>,
        referrer: Pubkey,
        pair: Pubkey,
    ) -> Result<()> {
        instructions::record_first_swap::handler(ctx, referrer, pair)
    }
}
