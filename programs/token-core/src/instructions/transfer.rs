use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Transfer};

use common_contracts::constants::BPS_DENOMINATOR;
use common_contracts::math::mul_div_ceil;

use crate::errors::TokenCoreError;
use crate::{TransferWithTax, TaxCollected, TransferNet};

pub fn handler(ctx: Context<TransferWithTax>, amount: u64) -> Result<()> {
    if amount == 0 {
        return err!(TokenCoreError::InvalidAmount);
    }

    let cfg = &ctx.accounts.config;

    // strict treasury ATA check: ATA(cfg.treasury, mint)
    let expected_treasury_ata =
        get_associated_token_address(&cfg.treasury, &ctx.accounts.mint.key());
    if ctx.accounts.treasury_ata.key() != expected_treasury_ata {
        return err!(TokenCoreError::InvalidTreasuryAta);
    }

    // fee = ceil(amount * tax_bps / 10_000)
    let fee = mul_div_ceil(amount, cfg.tax_bps as u64, BPS_DENOMINATOR)
        .map_err(|_| error!(TokenCoreError::MathOverflow))?;

    // no “free transfers”
    if fee == 0 || amount <= fee {
        return err!(TokenCoreError::AmountTooSmallForFee);
    }

    let net = amount
        .checked_sub(fee)
        .ok_or_else(|| error!(TokenCoreError::MathOverflow))?;

    // 1) fee -> treasury
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.from_ata.to_account_info(),
                to: ctx.accounts.treasury_ata.to_account_info(),
                authority: ctx.accounts.from_owner.to_account_info(),
            },
        ),
        fee,
    )?;

    // 2) net -> receiver
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.from_ata.to_account_info(),
                to: ctx.accounts.to_ata.to_account_info(),
                authority: ctx.accounts.from_owner.to_account_info(),
            },
        ),
        net,
    )?;

    emit!(TaxCollected {
        mint: ctx.accounts.mint.key(),
        from: ctx.accounts.from_owner.key(),
        treasury: cfg.treasury,
        treasury_ata: ctx.accounts.treasury_ata.key(),
        amount: fee,
        tax_bps: cfg.tax_bps,
    });

    emit!(TransferNet {
        mint: ctx.accounts.mint.key(),
        from: ctx.accounts.from_owner.key(),
        to: ctx.accounts.to_ata.key(),
        amount: net,
    });

    Ok(())
}
