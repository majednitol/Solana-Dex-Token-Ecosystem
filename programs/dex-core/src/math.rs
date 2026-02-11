use anchor_lang::prelude::*;
use crate::errors::DexError;

/// Constant product output:
/// out = (in * R_out) / (R_in + in)
#[inline(always)]
pub fn cp_out(amount_in: u64, reserve_in: u64, reserve_out: u64) -> Result<u64> {
    if reserve_in == 0 || reserve_out == 0 {
        return err!(DexError::InsufficientLiquidity);
    }

    let in_u = amount_in as u128;
    let rin = reserve_in as u128;
    let rout = reserve_out as u128;

    let num = in_u
        .checked_mul(rout)
        .ok_or_else(|| error!(DexError::MathOverflow))?;

    let den = rin
        .checked_add(in_u)
        .ok_or_else(|| error!(DexError::MathOverflow))?;

    Ok((num / den) as u64)
}

/// fee = ceil(amount * bps / 10_000)
#[inline(always)]
pub fn fee_ceil(amount: u64, bps: u16) -> Result<u64> {
    if bps == 0 {
        return Ok(0);
    }
    let amt = amount as u128;
    let bps_u = bps as u128;
    let den = 10_000u128;

    let num = amt
        .checked_mul(bps_u)
        .ok_or_else(|| error!(DexError::MathOverflow))?;

    Ok(((num + den - 1) / den) as u64)
}
