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

    let bit = 1u8
        .checked_shl(owner_index as u32)
        .ok_or_else(|| error!(MultisigError::Overflow))?;

    // ✅ prevent double-approve
    if (proposal.approvals_bitmap & bit) != 0 {
        return err!(MultisigError::AlreadyApproved);
    }

    proposal.approvals_bitmap |= bit;

    emit!(ProposalApproved {
        multisig: multisig.key(),
        proposal: proposal.key(),
        owner: owner_key,
    });

    Ok(())
}
