#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
#![deny(unsafe_code)]

use anchor_lang::prelude::*;
use common_contracts::constants::SEED_TREASURY;

pub mod errors;
pub mod instructions;
pub mod state;

use state::{AccountMetaLite, Multisig, Proposal, MAX_OWNERS};

pub const SEED_PROPOSAL: &[u8] = b"proposal";

declare_id!("Trsy111111111111111111111111111111111111111");

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

    #[account(
        init,
        payer = payer,
        space = Multisig::space(MAX_OWNERS),
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

    #[account(
        init,
        payer = proposer,
        space = Proposal::space(metas.len(), ix_data.len()),
        seeds = [SEED_PROPOSAL, multisig.key().as_ref(), nonce.to_le_bytes().as_ref()],
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
        // ✅ close proposal on success, refund rent to caller (or change to proposer if you prefer)
        close = caller
    )]
    pub proposal: Account<'info, Proposal>,
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
}
