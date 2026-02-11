use anchor_lang::prelude::*;
use crate::{RecordFirstSwap, ReferralRecorded};
use crate::errors::ReferralError;

pub fn handler(
    ctx: Context<RecordFirstSwap>,
    referrer: Pubkey,
    pair: Pubkey,
) -> Result<()> {
    let user_key = ctx.accounts.user.key();
    if user_key == Pubkey::default() {
        return err!(ReferralError::InvalidUser);
    }
    if referrer == Pubkey::default() {
        return err!(ReferralError::InvalidReferrer);
    }
    if user_key == referrer {
        return err!(ReferralError::SelfReferralNotAllowed);
    }

    let cfg = &ctx.accounts.config;
    if !cfg.initialized {
        return err!(ReferralError::InvalidConfig);
    }

    let dex_ok = {
        let dex_prog = &ctx.accounts.dex_program;
        dex_prog.key() == cfg.allowed_dex_program && dex_prog.executable
    };

    let treasury_ok = ctx
        .accounts
        .treasury_signer
        .as_ref()
        .map(|a| a.is_signer && a.key() == cfg.treasury)
        .unwrap_or(false);

    if !(dex_ok || treasury_ok) {
        return err!(ReferralError::Unauthorized);
    }

    let ts = Clock::get()?.unix_timestamp;

    let referee = &mut ctx.accounts.referee;
    referee.bump = ctx.bumps.referee;
    referee.user = user_key;
    referee.referrer = referrer;
    referee.pair = pair;
    referee.recorded_at = ts;

    emit!(ReferralRecorded {
        user: user_key,
        referrer,
        pair,
        ts,
    });

    Ok(())
}
