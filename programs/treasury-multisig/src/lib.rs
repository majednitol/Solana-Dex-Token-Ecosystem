#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;
use common_contracts::constants::SEED_TREASURY;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use state::*;

pub const SEED_PROPOSAL: &[u8] = b"proposal";

declare_id!("MXCWnwznqDHe9BXnYbxTV5BVu1JoDJnSfcupqnbCdaT");



#[event]
pub struct MultisigInitialized {
    pub multisig: Pubkey,
    pub threshold: u8,
    pub owners_len: u8,
    pub nonce: u64,
}

#[event]
pub struct ProposalCreated {
    pub multisig: Pubkey,
    pub proposal: Pubkey,
    pub proposer: Pubkey,
    pub nonce: u64,
    pub target_program: Pubkey,
}

#[event]
pub struct ProposalApproved {
    pub multisig: Pubkey,
    pub proposal: Pubkey,
    pub owner: Pubkey,
    pub approvals: u8,
}

#[event]
pub struct ProposalExecuted {
    pub multisig: Pubkey,
    pub proposal: Pubkey,
    pub caller: Pubkey,
    pub target_program: Pubkey,
}



#[derive(Accounts)]
#[instruction(owners: Vec<Pubkey>, threshold: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Treasury PDA / Multisig state
    #[account(
        init,
        payer = payer,
        space = Multisig::space(),
        seeds = [SEED_TREASURY],
        bump
    )]
    pub multisig: Account<'info, Multisig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(target_program: Pubkey, metas: Vec<AccountMetaLite>, ix_data: Vec<u8>, nonce: u64)]
pub struct Propose<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_TREASURY],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, Multisig>,

    /// Proposal PDA: (proposal, multisig, nonce)
    #[account(
        init,
        payer = proposer,
        space = Proposal::space(metas.len(), ix_data.len()),
        seeds = [SEED_PROPOSAL, multisig.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Approve<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_TREASURY],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, Multisig>,

    #[account(mut, has_one = multisig)]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    pub caller: Signer<'info>,

    #[account(
        seeds = [SEED_TREASURY],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, Multisig>,

    #[account(
        mut,
        has_one = multisig,
        close = caller
    )]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct Dummy<'info> {
    /// CHECK: This is the program executable account, required only so that CPI can include it.
    /// need to verify key == crate::ID and executable == true in the handler.
    pub this_program: UncheckedAccount<'info>,

    /// Multisig PDA state. Must be the SEED_TREASURY PDA.
    #[account(
        seeds = [SEED_TREASURY],
        bump = multisig.bump
    )]
    pub multisig: Account<'info, Multisig>,
}


#[program]
pub mod treasury_multisig_contracts {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owners: Vec<Pubkey>, threshold: u8) -> Result<()> {
        instructions::initialize::handler(ctx, owners, threshold)
    }

    pub fn propose(
        ctx: Context<Propose>,
        target_program: Pubkey,
        metas: Vec<AccountMetaLite>,
        ix_data: Vec<u8>,
        nonce: u64,
    ) -> Result<()> {
        instructions::propose::handler(ctx, target_program, metas, ix_data, nonce)
    }

    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        instructions::approve::handler(ctx)
    }

    pub fn execute(ctx: Context<Execute>) -> Result<()> {
        instructions::execute::handler(ctx)
    }

pub fn dummy(ctx: Context<Dummy>) -> Result<()> {
    // Program account must be correct + executable
    if ctx.accounts.this_program.key() != crate::ID || !ctx.accounts.this_program.executable {
        return err!(MultisigError::AccountListMismatch);
    }

    // In CPI execute(), multisig PDA should be marked signer via invoke_signed
    if !ctx.accounts.multisig.to_account_info().is_signer {
        return err!(MultisigError::InvalidSignerMeta);
    }

    msg!("Dummy CPI executed");
    Ok(())
}


}
