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

    // approvals >= threshold
    let approvals = proposal.approvals_bitmap.count_ones() as u8;
    if approvals < multisig.threshold {
        return err!(MultisigError::NotEnoughApprovals);
    }

    let rem = ctx.remaining_accounts;

  
    if rem.len() != proposal.metas.len() {
        return err!(MultisigError::AccountListMismatch);
    }


    {
        let mut found = false;
        for acc in rem.iter() {
            if acc.key() == proposal.target_program {
                if !acc.executable {
                    return err!(MultisigError::AccountListMismatch);
                }
                found = true;
                break;
            }
        }
        if !found {
            return err!(MultisigError::AccountListMismatch);
        }
    }

    let multisig_key = multisig.key();


    for i in 0..proposal.metas.len() {
        for j in (i + 1)..proposal.metas.len() {
            if proposal.metas[i].pubkey == proposal.metas[j].pubkey {
                return err!(MultisigError::AccountListMismatch);
            }
        }
    }

    for (i, meta) in proposal.metas.iter().enumerate() {
        let acc = &rem[i];

        if acc.key() != meta.pubkey {
            return err!(MultisigError::AccountListMismatch);
        }

        // signer-meta rule: only multisig PDA may be marked signer
        if meta.is_signer && meta.pubkey != multisig_key {
            return err!(MultisigError::InvalidSignerMeta);
        }

        // writable must match exactly
        if acc.is_writable != meta.is_writable {
            return err!(MultisigError::AccountMetaFlagsMismatch);
        }
    }

    // build instruction
    let ix_accounts: Vec<AccountMeta> = proposal.metas.iter().map(to_account_meta).collect();
    let ix = Instruction {
        program_id: proposal.target_program,
        accounts: ix_accounts,
        data: proposal.ix_data.clone(),
    };

    // multisig PDA signs
    let bump = multisig.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[SEED_TREASURY, &[bump]]];

    // invoke CPI
    invoke_signed(&ix, rem, signer_seeds)?;

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
