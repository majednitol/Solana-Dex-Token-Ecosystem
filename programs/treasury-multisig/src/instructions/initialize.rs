use anchor_lang::prelude::*;
use crate::{Initialize, ProposalCreated};
use crate::errors::MultisigError;
use crate::state::MAX_OWNERS;

pub fn handler(ctx: Context<Initialize>, owners: Vec<Pubkey>, threshold: u8) -> Result<()> {
    if owners.is_empty() || owners.len() > MAX_OWNERS {
        return err!(MultisigError::InvalidOwners);
    }

    for i in 0..owners.len() {
        for j in (i + 1)..owners.len() {
            if owners[i] == owners[j] {
                return err!(MultisigError::DuplicateOwner);
            }
        }
    }

    if threshold == 0 || threshold as usize > owners.len() {
        return err!(MultisigError::InvalidThreshold);
    }

    let multisig = &mut ctx.accounts.multisig;
    multisig.bump = ctx.bumps.multisig;
    multisig.threshold = threshold;
    multisig.owners = owners;
    multisig.nonce = 0;

    // no event needed here (optional)
    Ok(())
}
