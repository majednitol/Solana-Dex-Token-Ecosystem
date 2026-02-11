use anchor_lang::prelude::*;
use crate::{Propose, ProposalCreated};
use crate::errors::MultisigError;
use crate::state::{AccountMetaLite, MAX_IX_DATA, MAX_METAS};

pub fn handler(
    ctx: Context<Propose>,
    target_program: Pubkey,
    metas: Vec<AccountMetaLite>,
    ix_data: Vec<u8>,
    nonce: u64,
) -> Result<()> {
    if metas.len() > MAX_METAS {
        return err!(MultisigError::TooManyMetas);
    }
    if ix_data.len() > MAX_IX_DATA {
        return err!(MultisigError::IxDataTooLarge);
    }

    let proposer_key = ctx.accounts.proposer.key();
    let multisig_key = ctx.accounts.multisig.key();
    let current_nonce = ctx.accounts.multisig.nonce;

    if nonce != current_nonce {
        return err!(MultisigError::InvalidNonce);
    }

    // signer-meta rule: only multisig PDA may be signer
    for m in metas.iter() {
        if m.is_signer && m.pubkey != multisig_key {
            return err!(MultisigError::InvalidSignerMeta);
        }
    }

    // proposer must be an owner
    let multisig = &mut ctx.accounts.multisig;
    let owner_index = multisig
        .owners
        .iter()
        .position(|k| *k == proposer_key)
        .ok_or_else(|| error!(MultisigError::Unauthorized))?;

    // approvals bitmap must fit within u8
    if owner_index >= 8 {
        return err!(MultisigError::Overflow);
    }

    let bit = 1u8
        .checked_shl(owner_index as u32)
        .ok_or_else(|| error!(MultisigError::Overflow))?;

    // write proposal
    let proposal = &mut ctx.accounts.proposal;
    proposal.multisig = multisig_key;
    proposal.proposer = proposer_key;
    proposal.target_program = target_program;
    proposal.metas = metas;
    proposal.ix_data = ix_data;
    proposal.executed = false;
    proposal.nonce = current_nonce;

    // auto-approve proposer
    proposal.approvals_bitmap = bit;

   
    multisig.nonce = multisig
        .nonce
        .checked_add(1)
        .ok_or_else(|| error!(MultisigError::Overflow))?;

    emit!(ProposalCreated {
        multisig: multisig_key,
        proposal: proposal.key(),
        proposer: proposer_key,
        nonce: current_nonce,
        target_program,
    });

    Ok(())
}
