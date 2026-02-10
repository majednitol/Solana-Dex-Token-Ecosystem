use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use common_contracts::constants::SEED_TREASURY;

use crate::{Execute, ProposalExecuted};
use crate::errors::MultisigError;
use crate::state::AccountMetaLite;

pub fn handler(ctx: Context<Execute>) -> Result<()> {
    let multisig = &ctx.accounts.multisig;
    let proposal = &mut ctx.accounts.proposal;

    if proposal.executed {
        return err!(MultisigError::ProposalAlreadyExecuted);
    }

    let approvals = proposal.approvals_bitmap.count_ones() as u8;
    if approvals < multisig.threshold {
        return err!(MultisigError::NotEnoughApprovals);
    }

    let rem = ctx.remaining_accounts;
    if rem.len() != proposal.metas.len() {
        return err!(MultisigError::AccountListMismatch);
    }

    for (i, meta) in proposal.metas.iter().enumerate() {
        if rem[i].key() != meta.pubkey {
            return err!(MultisigError::AccountListMismatch);
        }
    }

    let metas: Vec<AccountMeta> = proposal.metas.iter().map(to_account_meta).collect();

    let ix = Instruction {
        program_id: proposal.target_program,
        accounts: metas,
        data: proposal.ix_data.clone(),
    };

    let bump = multisig.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_TREASURY, &[bump]]];

    invoke_signed(&ix, rem, signer_seeds)?;

    // mark executed (account will close because of `close = caller` in Execute context)
    proposal.executed = true;

    emit!(ProposalExecuted {
        multisig: multisig.key(),
        proposal: proposal.key(),
        caller: ctx.accounts.caller.key(),
        target_program: proposal.target_program,
    });

    Ok(())
}

fn to_account_meta(m: &AccountMetaLite) -> AccountMeta {
    if m.is_writable {
        AccountMeta::new(m.pubkey, m.is_signer)
    } else {
        AccountMeta::new_readonly(m.pubkey, m.is_signer)
    }
}
