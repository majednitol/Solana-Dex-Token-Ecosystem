use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, SetAuthority};
use anchor_spl::token::spl_token::instruction::AuthorityType;

use common_contracts::constants::TRANSFER_TAX_BPS;

use crate::errors::TokenCoreError;
use crate::state::SEED_TOKEN_CONFIG;
use crate::{InitializeMint, TokenConfig};

pub fn handler(
    ctx: Context<InitializeMint>,
    decimals: u8,
    fixed_supply: u64,
    treasury: Pubkey,
) -> Result<()> {
    if fixed_supply == 0 {
        return err!(TokenCoreError::InvalidAmount);
    }

    // --- production checks (no removal, only safety) ---
    // Ensure the passed treasury pubkey matches the provided treasury account
    require_keys_eq!(
        ctx.accounts.treasury_account.key(),
        treasury,
        TokenCoreError::Unauthorized
    );

    // Ensure config PDA is exactly the PDA we expect
    // (Also gives us the bump without using ctx.bumps -> fixes your Bumps error)
    let (expected_cfg, bump) = Pubkey::find_program_address(
        &[SEED_TOKEN_CONFIG, ctx.accounts.mint.key().as_ref()],
        ctx.program_id,
    );
    require_keys_eq!(
        expected_cfg,
        ctx.accounts.config.key(),
        TokenCoreError::InvalidConfigPda
    );

    // Ensure ATA owners match their authority wallets (defense-in-depth)
    require_keys_eq!(
        ctx.accounts.initial_recipient_ata.owner,
        ctx.accounts.initial_recipient_owner.key(),
        TokenCoreError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.treasury_ata.owner,
        ctx.accounts.treasury_account.key(),
        TokenCoreError::InvalidTreasuryAta
    );
 

    // 1) create config
    let cfg: &mut Account<TokenConfig> = &mut ctx.accounts.config;
    cfg.bump = bump;
    cfg.mint = ctx.accounts.mint.key();
    cfg.treasury = treasury;
    cfg.decimals = decimals;
    cfg.tax_bps = TRANSFER_TAX_BPS;
    cfg.renounced = false;

    // 2) Mint full fixed supply to recipient (payer is temporary mint authority)
    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.initial_recipient_ata.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        fixed_supply,
    )?;

    // 3) Move mint authority to config PDA (program-controlled)
    token::set_authority(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        AuthorityType::MintTokens,
        Some(ctx.accounts.config.key()),
    )?;

    // 4) Remove freeze authority (prevents admin freezing user funds)
    token::set_authority(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        AuthorityType::FreezeAccount,
        None,
    )?;

    Ok(())
}
