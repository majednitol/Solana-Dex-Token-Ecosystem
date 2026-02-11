use anchor_lang::prelude::*;
use crate::{constants::BPS_DENOMINATOR, errors::CommonError};

/// Checked add
#[inline(always)]
pub fn checked_add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(CommonError::MathOverflow))
}

/// Checked sub
#[inline(always)]
pub fn checked_sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(CommonError::MathOverflow))
}

/// Checked mul
#[inline(always)]
pub fn checked_mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or_else(|| error!(CommonError::MathOverflow))
}

/// Checked div (b must be > 0)
#[inline(always)]
pub fn checked_div(a: u64, b: u64) -> Result<u64> {
    if b == 0 {
        return err!(CommonError::DivisionByZero);
    }
    Ok(a / b)
}

/// ceil_div(a, b) = ⌈a/b⌉ (b must be > 0)
#[inline(always)]
pub fn ceil_div(a: u64, b: u64) -> Result<u64> {
    if b == 0 {
        return err!(CommonError::DivisionByZero);
    }
    // (a + b - 1) / b but safe for overflow:
    if a == 0 {
        return Ok(0);
    }
    Ok(((a - 1) / b) + 1)
}

/// (a * b) / denom with u128 math (floor). denom must be > 0.
#[inline(always)]
pub fn mul_div_floor(a: u64, b: u64, denom: u64) -> Result<u64> {
    if denom == 0 {
        return err!(CommonError::DivisionByZero);
    }
    let prod = (a as u128)
        .checked_mul(b as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;
    Ok((prod / denom as u128) as u64)
}

/// ⌈(a * b) / denom⌉ with u128 math. denom must be > 0.
#[inline(always)]
pub fn mul_div_ceil(a: u64, b: u64, denom: u64) -> Result<u64> {
    if denom == 0 {
        return err!(CommonError::DivisionByZero);
    }
    let prod = (a as u128)
        .checked_mul(b as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;
    let d = denom as u128;
    Ok(((prod + d - 1) / d) as u64)
}

/// fee_floor(amount, bps) = floor(amount * bps / 10_000)
#[inline(always)]
pub fn fee_floor(amount: u64, bps: u16) -> Result<u64> {
    mul_div_floor(amount, bps as u64, BPS_DENOMINATOR)
}

/// fee_ceil(amount, bps) = ceil(amount * bps / 10_000)
#[inline(always)]
pub fn fee_ceil(amount: u64, bps: u16) -> Result<u64> {
    mul_div_ceil(amount, bps as u64, BPS_DENOMINATOR)
}

/// Split amount into (net, fee) using floor fee.
#[inline(always)]
pub fn split_fee_floor(amount: u64, bps: u16) -> Result<(u64, u64)> {
    let fee = fee_floor(amount, bps)?;
    let net = checked_sub(amount, fee)?;
    Ok((net, fee))
}

/// Split amount into (net, fee) using ceil fee.
#[inline(always)]
pub fn split_fee_ceil(amount: u64, bps: u16) -> Result<(u64, u64)> {
    let fee = fee_ceil(amount, bps)?;
    let net = checked_sub(amount, fee)?;
    Ok((net, fee))
}

/// ------------------------------
/// Constant-product AMM helpers
/// ------------------------------
/// cp_out(dx, x, y) = (dx * y) / (x + dx)
/// - dx: amount in
/// - x: reserve in
/// - y: reserve out
///
/// NOTE: this is "Orca-style constant product math" baseline.
/// Fees should be applied outside (caller decides).
#[inline(always)]
pub fn cp_out(dx: u64, x: u64, y: u64) -> Result<u64> {
    if dx == 0 {
        return err!(CommonError::InvalidAmount);
    }
    if x == 0 || y == 0 {
        return err!(CommonError::InvalidArgument);
    }

    let num = (dx as u128)
        .checked_mul(y as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;

    let den = (x as u128)
        .checked_add(dx as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;

    Ok((num / den) as u64)
}

/// cp_in(dy, x, y) = ceil( (dy * x) / (y - dy) )
/// - dy: desired amount out
/// - x: reserve in
/// - y: reserve out
#[inline(always)]
pub fn cp_in(dy: u64, x: u64, y: u64) -> Result<u64> {
    if dy == 0 {
        return err!(CommonError::InvalidAmount);
    }
    if x == 0 || y == 0 {
        return err!(CommonError::InvalidArgument);
    }
    if dy >= y {
        return err!(CommonError::InvalidArgument);
    }

    let num = (dy as u128)
        .checked_mul(x as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;

    let den = (y as u128)
        .checked_sub(dy as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;

    // ceil(num/den)
    Ok(((num + den - 1) / den) as u64)
}
