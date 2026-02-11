use anchor_lang::prelude::*;

pub const MAX_OWNERS: usize = 8;        // bitmap is u8 => max 8
pub const MAX_METAS: usize = 64;        // align with common MAX_IX_ACCOUNTS
pub const MAX_IX_DATA: usize = 1024;    // cap for safety

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountMetaLite {
    pub pubkey: Pubkey,
    pub is_writable: bool,
    pub is_signer: bool,
}

impl AccountMetaLite {
    /// Conservative serialized size:
    /// pubkey(32) + bool(1) + bool(1) = 34 bytes.
    /// Borsh does not pad bools, but keep +1 as safety margin.
    pub const fn serialized_size() -> usize {
        32 + 1 + 1
    }
}

#[account]
pub struct Multisig {
    pub bump: u8,
    pub threshold: u8,
    pub owners: Vec<Pubkey>, // stored with fixed max allocation in space()
    pub nonce: u64,
}

impl Multisig {
    pub fn space() -> usize {
        // disc(8)
        // bump(1) + threshold(1)
        // owners vec: 4 + 32*MAX_OWNERS (we allocate full max)
        // nonce(8)
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
        // disc(8)
        // multisig/proposer/target_program = 32*3
        // metas vec: 4 + metas_len * size(AccountMetaLite)
        // ix_data vec: 4 + ix_len
        // approvals_bitmap(1) + executed(1) + nonce(8)
        let metas_part = 4 + metas_len * AccountMetaLite::serialized_size();
        let ix_part = 4 + ix_len;
        8 + (32 * 3) + metas_part + ix_part + 1 + 1 + 8
    }
}
