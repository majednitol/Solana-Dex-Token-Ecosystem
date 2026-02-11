use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::{SwapExactIn, SwapExecuted};
use crate::errors::DexError;
use crate::math::{cp_out, fee_ceil};
use crate::state::SEED_PAIR;
use crate::assert_treasury_knite_ata;

pub fn handler(ctx: Context<SwapExactIn>, amount_in: u64, min_out: u64) -> Result<()> {
    if amount_in == 0 {
        return err!(DexError::InvalidAmount);
    }

    let pair = &ctx.accounts.pair;
    if !pair.enabled {
        return err!(DexError::PairDisabled);
    }

    let mint_in = ctx.accounts.mint_in.key();
    let mint_out = ctx.accounts.mint_out.key();

    let is_knite_in = mint_in == pair.mint_knite;
    let is_knite_out = mint_out == pair.mint_knite;

    // internal-only: must be exactly knite <-> sub
    if !((is_knite_in && mint_out == pair.mint_sub) || (is_knite_out && mint_in == pair.mint_sub))
    {
        return err!(DexError::TokenNotAllowed);
    }

    // validate treasury knite ATA
    assert_treasury_knite_ata(pair, ctx.accounts.treasury_knite_ata.key())?;

    // reserves before
    let reserve_knite = ctx.accounts.vault_knite.amount;
    let reserve_sub = ctx.accounts.vault_sub.amount;

  
    // signer seeds for pair PDA (PRODUCTION-SAFE)
    
    let bump = pair.bump;
    let bump_seed = [bump]; // stable stack value

    let seeds: &[&[u8]] = &[
        SEED_PAIR,
        pair.treasury.as_ref(),
        pair.mint_knite.as_ref(),
        pair.mint_sub.as_ref(),
        &bump_seed,
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let fee_knite: u64;
    let amount_out: u64;

    if is_knite_in {
       
        // kNite -> Sub
        // fee from INPUT kNite (user -> treasury)
      
        fee_knite = fee_ceil(amount_in, pair.swap_fee_bps)?;
        if fee_knite == 0 || amount_in <= fee_knite {
            return err!(DexError::InvalidAmount);
        }

        let net_in = amount_in
            .checked_sub(fee_knite)
            .ok_or_else(|| error!(DexError::MathOverflow))?;

        // output in sub token
        let out_sub = cp_out(net_in, reserve_knite, reserve_sub)?;
        if out_sub < min_out {
            return err!(DexError::SlippageExceeded);
        }
        amount_out = out_sub;

        // 1) fee kNite user -> treasury ATA
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_ata_in.to_account_info(),
                    to: ctx.accounts.treasury_knite_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            fee_knite,
        )?;

        // 2) net kNite user -> vault_knite
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_ata_in.to_account_info(),
                    to: ctx.accounts.vault_knite.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            net_in,
        )?;

        // 3) sub vault_sub -> user (pair signs)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_sub.to_account_info(),
                    to: ctx.accounts.user_ata_out.to_account_info(),
                    authority: ctx.accounts.pair.to_account_info(),
                },
                signer_seeds,
            ),
            amount_out,
        )?;
    } else {
       
        // Sub -> kNite
        // fee from OUTPUT kNite (vault -> treasury)
   
        let gross_knite_out = cp_out(amount_in, reserve_sub, reserve_knite)?;

        fee_knite = fee_ceil(gross_knite_out, pair.swap_fee_bps)?;
        if fee_knite == 0 || gross_knite_out <= fee_knite {
            return err!(DexError::InvalidAmount);
        }

        let net_knite_out = gross_knite_out
            .checked_sub(fee_knite)
            .ok_or_else(|| error!(DexError::MathOverflow))?;

        if net_knite_out < min_out {
            return err!(DexError::SlippageExceeded);
        }
        amount_out = net_knite_out;

        // 1) sub user -> vault_sub
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_ata_in.to_account_info(),
                    to: ctx.accounts.vault_sub.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
        )?;

        // 2) fee kNite vault_knite -> treasury (pair signs)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_knite.to_account_info(),
                    to: ctx.accounts.treasury_knite_ata.to_account_info(),
                    authority: ctx.accounts.pair.to_account_info(),
                },
                signer_seeds,
            ),
            fee_knite,
        )?;

        // 3) net kNite vault_knite -> user (pair signs)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_knite.to_account_info(),
                    to: ctx.accounts.user_ata_out.to_account_info(),
                    authority: ctx.accounts.pair.to_account_info(),
                },
                signer_seeds,
            ),
            amount_out,
        )?;
    }

    emit!(SwapExecuted {
        pair: ctx.accounts.pair.key(),
        user: ctx.accounts.user.key(),
        mint_in,
        mint_out,
        amount_in,
        amount_out,
        fee_knite,
    });

    Ok(())
}
