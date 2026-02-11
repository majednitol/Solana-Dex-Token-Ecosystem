use anchor_lang::prelude::*;

pub const SEED_PAIR: &[u8] = b"pair";
pub const SEED_VAULT_KNITE: &[u8] = b"vault_knite";
pub const SEED_VAULT_SUB: &[u8] = b"vault_sub";

#[account]
pub struct Pair {
    pub bump: u8,
    pub vault_knite_bump: u8,
    pub vault_sub_bump: u8,

    pub treasury: Pubkey,

    // Only allowed mints
    pub mint_knite: Pubkey,
    pub mint_sub: Pubkey,

    // Vault token accounts (authority MUST be pair PDA)
    pub vault_knite: Pubkey,
    pub vault_sub: Pubkey,

    pub swap_fee_bps: u16, // 30 bps (0.3%)
    pub enabled: bool,
}

impl Pair {
    pub fn space() -> usize {
        // disc(8)
        // bumps(3)
        // treasury(32)
        // mints(64)
        // vaults(64)
        // fee(2)
        // enabled(1)
        8 + 3 + 32 + 64 + 64 + 2 + 1
    }
}
