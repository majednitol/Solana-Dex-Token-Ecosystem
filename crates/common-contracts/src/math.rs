// programs/common/src/math.rs
use crate::errors::CommonError;
use anchor_lang::prelude::*;

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
        return err!(CommonError::InvalidArgument);
    }
    Ok(a / b)
}

/// ceil_div(a, b) = ⌈a/b⌉  (b must be > 0)
#[inline(always)]
pub fn ceil_div(a: u64, b: u64) -> Result<u64> {
    if b == 0 {
        return err!(CommonError::InvalidArgument);
    }
    Ok((a + b - 1) / b)
}

/// Multiply then divide with overflow checks: (a * b) / denom
/// denom must be > 0.
#[inline(always)]
pub fn mul_div(a: u64, b: u64, denom: u64) -> Result<u64> {
    if denom == 0 {
        return err!(CommonError::InvalidArgument);
    }
    let prod = (a as u128)
        .checked_mul(b as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;
    Ok((prod / denom as u128) as u64)
}

/// Multiply then divide with rounding up: ⌈(a*b)/denom⌉
#[inline(always)]
pub fn mul_div_ceil(a: u64, b: u64, denom: u64) -> Result<u64> {
    if denom == 0 {
        return err!(CommonError::InvalidArgument);
    }
    let prod = (a as u128)
        .checked_mul(b as u128)
        .ok_or_else(|| error!(CommonError::MathOverflow))?;
    let denom_u = denom as u128;
    Ok(((prod + denom_u - 1) / denom_u) as u64)
}

/// Calculate basis points fee (floor): amount * bps / 10_000
#[inline(always)]
pub fn fee_from_bps(amount: u64, bps: u16) -> Result<u64> {
    mul_div(amount, bps as u64, crate::constants::BPS_DENOMINATOR)
}

/// Calculate basis points fee (ceil): ⌈amount * bps / 10_000⌉
/// Useful when you want to ensure minimum fee collection.
#[inline(always)]
pub fn fee_from_bps_ceil(amount: u64, bps: u16) -> Result<u64> {
    mul_div_ceil(amount, bps as u64, crate::constants::BPS_DENOMINATOR)
}

/// Split amount into (net, fee) using floor fee.
#[inline(always)]
pub fn split_fee_floor(amount: u64, bps: u16) -> Result<(u64, u64)> {
    let fee = fee_from_bps(amount, bps)?;
    let net = checked_sub(amount, fee)?;
    Ok((net, fee))
}

/// Split amount into (net, fee) using ceil fee.
#[inline(always)]
pub fn split_fee_ceil(amount: u64, bps: u16) -> Result<(u64, u64)> {
    let fee = fee_from_bps_ceil(amount, bps)?;
    let net = checked_sub(amount, fee)?;
    Ok((net, fee))
}
