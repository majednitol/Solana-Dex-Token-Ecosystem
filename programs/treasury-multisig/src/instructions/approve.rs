use anchor_lang::prelude::*;
use crate::{Approve, ProposalApproved};
use crate::errors::MultisigError;

pub fn handler(ctx: Context<Approve>) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let proposal = &mut ctx.accounts.proposal;

    if proposal.executed {
        return err!(MultisigError::ProposalAlreadyExecuted);
    }

    let owner_key = ctx.accounts.owner.key();

    let owner_index = multisig
        .owners
        .iter()
        .position(|k| *k == owner_key)
        .ok_or_else(|| error!(MultisigError::Unauthorized))?;

    if owner_index >= 8 {
        return err!(MultisigError::Overflow);
    }

    let bit = 1u8
        .checked_shl(owner_index as u32)
        .ok_or_else(|| error!(MultisigError::Overflow))?;

    if (proposal.approvals_bitmap & bit) != 0 {
        return err!(MultisigError::AlreadyApproved);
    }

    proposal.approvals_bitmap |= bit;

    let approvals = proposal.approvals_bitmap.count_ones() as u8;

    emit!(ProposalApproved {
        multisig: multisig.key(),
        proposal: proposal.key(),
        owner: owner_key,
        approvals,
    });

    Ok(())
}
