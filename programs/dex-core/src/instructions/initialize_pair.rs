use anchor_lang::prelude::*;
use common_contracts::constants::SWAP_FEE_BPS;

use crate::{InitializePair, PairInitialized};
use crate::errors::DexError;

pub fn handler(ctx: Context<InitializePair>, treasury: Pubkey) -> Result<()> {
    // treasury must match signer
    if ctx.accounts.treasury_signer.key() != treasury {
        return err!(DexError::Unauthorized);
    }

    // prevent same mint
    if ctx.accounts.mint_knite.key() == ctx.accounts.mint_sub.key() {
        return err!(DexError::MintMismatch);
    }

    let pair = &mut ctx.accounts.pair;

    pair.bump = ctx.bumps.pair;
    pair.vault_knite_bump = ctx.bumps.vault_knite;
    pair.vault_sub_bump = ctx.bumps.vault_sub;

    pair.treasury = treasury;

    pair.mint_knite = ctx.accounts.mint_knite.key();
    pair.mint_sub = ctx.accounts.mint_sub.key();

    pair.vault_knite = ctx.accounts.vault_knite.key();
    pair.vault_sub = ctx.accounts.vault_sub.key();

    pair.swap_fee_bps = SWAP_FEE_BPS; // 30 bps
    pair.enabled = true;

    //  vault authority must be pair PDA (TokenAccount.owner == authority pubkey)
    if ctx.accounts.vault_knite.owner != pair.key() || ctx.accounts.vault_sub.owner != pair.key() {
        return err!(DexError::Unauthorized);
    }

    emit!(PairInitialized {
        pair: pair.key(),
        treasury: pair.treasury,
        mint_knite: pair.mint_knite,
        mint_sub: pair.mint_sub,
        vault_knite: pair.vault_knite,
        vault_sub: pair.vault_sub,
        fee_bps: pair.swap_fee_bps,
    });

    Ok(())
}
