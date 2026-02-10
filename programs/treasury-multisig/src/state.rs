use anchor_lang::prelude::*;

pub const MAX_OWNERS: usize = 8;
pub const MAX_METAS: usize = 32;
pub const MAX_IX_DATA: usize = 1024;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountMetaLite {
    pub pubkey: Pubkey,
    pub is_writable: bool,
    pub is_signer: bool,
}

#[account]
pub struct Multisig {
    pub bump: u8,
    pub threshold: u8,
    pub owners: Vec<Pubkey>,
    pub nonce: u64,
}

impl Multisig {
    pub fn space(_owners_len: usize) -> usize {
        // Always allocate for MAX_OWNERS for stability
        8 + 1 + 1 + 4 + (32 * MAX_OWNERS) + 8
    }
}

#[account]
pub struct Proposal {
    pub multisig: Pubkey,
    pub proposer: Pubkey,
    pub target_program: Pubkey,
    pub metas: Vec<AccountMetaLite>,
    pub ix_data: Vec<u8>,
    pub approvals_bitmap: u8,
    pub executed: bool,
    pub nonce: u64,
}

impl Proposal {
    pub fn space(metas_len: usize, ix_len: usize) -> usize {
        8 + 96 + (4 + metas_len * (32 + 1 + 1)) + (4 + ix_len) + 1 + 1 + 8
    }
}
