use anchor_lang::prelude::*;
use anchor_spl::token::{self, SetAuthority};
use anchor_spl::token::spl_token::instruction::AuthorityType;

use crate::errors::TokenCoreError;
use crate::state::SEED_TOKEN_CONFIG;
use crate::RenounceMintAuthority;

pub fn handler(ctx: Context<RenounceMintAuthority>) -> Result<()> {
    
    let treasury = ctx.accounts.config.treasury;
    let already_renounced = ctx.accounts.config.renounced;
    let bump = ctx.accounts.config.bump;


    if ctx.accounts.treasury_signer.key() != treasury {
        return err!(TokenCoreError::Unauthorized);
    }

    if already_renounced {
        return err!(TokenCoreError::AlreadyRenounced);
    }

    let mint_key = ctx.accounts.mint.key();

   
    let signer_seeds: &[&[&[u8]]] = &[&[
        SEED_TOKEN_CONFIG,
        mint_key.as_ref(),
        &[bump],
    ]];

   
    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        AuthorityType::MintTokens,
        None,
    )?;


    ctx.accounts.config.renounced = true;

    Ok(())
}
