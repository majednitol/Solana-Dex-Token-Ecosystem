use anchor_lang::prelude::*;
use crate::{constants::is_zero_pubkey, errors::CommonError};

#[inline(always)]
pub fn require_true(cond: bool, err: CommonError) -> Result<()> {
    if cond { Ok(()) } else { Err(error!(err)) }
}

#[inline(always)]
pub fn require_nonzero(amount: u64) -> Result<()> {
    require_true(amount > 0, CommonError::InvalidAmount)
}

#[inline(always)]
pub fn require_nonzero_pubkey(pk: &Pubkey) -> Result<()> {
    require_true(!is_zero_pubkey(pk), CommonError::InvalidArgument)
}

#[inline(always)]
pub fn require_pubkey_eq(a: &Pubkey, b: &Pubkey, err: CommonError) -> Result<()> {
    require_true(a == b, err)
}

/// PDA helper (program_id + seeds)
#[inline(always)]
pub fn derive_pda(program_id: &Pubkey, seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, program_id)
}

#[inline(always)]
pub fn require_owned_by(acc_owner: &Pubkey, expected_owner: &Pubkey) -> Result<()> {
    require_true(acc_owner == expected_owner, CommonError::InvalidProgramId)
}

/// whitelist check helper (simple slice)
#[inline(always)]
pub fn require_whitelisted(mint: &Pubkey, whitelist: &[Pubkey]) -> Result<()> {
    if whitelist.iter().any(|m| m == mint) {
        Ok(())
    } else {
        Err(error!(CommonError::TokenNotAllowed))
    }
}

#[inline(always)]
pub fn now_ts() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

#[inline(always)]
pub fn now_slot() -> Result<u64> {
    Ok(Clock::get()?.slot)
}

/// --- SPL helpers (ONLY compiled when feature "spl" enabled) ---
#[cfg(feature = "spl")]
pub mod spl {
    use super::*;
    use anchor_spl::token::{self, Token, TokenAccount, Transfer};

    #[inline(always)]
    pub fn require_token_mint(ta: &TokenAccount, expected_mint: &Pubkey) -> Result<()> {
        require_pubkey_eq(&ta.mint, expected_mint, CommonError::MintMismatch)
    }

    #[inline(always)]
    pub fn require_token_owner(ta: &TokenAccount, expected_owner: &Pubkey) -> Result<()> {
        require_pubkey_eq(&ta.owner, expected_owner, CommonError::TokenOwnerMismatch)
    }

    pub fn spl_transfer<'info>(
        token_program: Program<'info, Token>,
        from: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        require_nonzero(amount)?;
        let cpi_accounts = Transfer { from, to, authority };
        let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)
    }

    pub fn spl_transfer_signed<'info>(
        token_program: Program<'info, Token>,
        from: AccountInfo<'info>,
        to: AccountInfo<'info>,
        authority: AccountInfo<'info>,
        signer_seeds: &[&[&[u8]]],
        amount: u64,
    ) -> Result<()> {
        require_nonzero(amount)?;
        let cpi_accounts = Transfer { from, to, authority };
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)
    }
}
