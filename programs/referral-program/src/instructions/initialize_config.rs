use anchor_lang::prelude::*;

use crate::errors::ReferralError;
use crate::state::SEED_REFERRAL_CONFIG;
use crate::InitializeConfig;

pub fn handler(
    ctx: Context<InitializeConfig>,
    allowed_dex_program: Pubkey,
    treasury: Pubkey,
) -> Result<()> {
    if allowed_dex_program == Pubkey::default() || treasury == Pubkey::default() {
        return err!(ReferralError::InvalidConfig);
    }

    let cfg = &mut ctx.accounts.config;

    if cfg.initialized {
        return err!(ReferralError::AlreadyInitialized);
    }
    let (expected_pda, bump) =
        Pubkey::find_program_address(&[SEED_REFERRAL_CONFIG], ctx.program_id);

    if expected_pda != cfg.key() {
        return err!(ReferralError::InvalidConfig);
    }

    cfg.bump = bump;
    cfg.initialized = true;
    cfg.allowed_dex_program = allowed_dex_program;
    cfg.treasury = treasury;

    Ok(())
}
