use anchor_lang::prelude::*;

pub const SEED_POOL: &[u8] = b"pool";
pub const SEED_VAULT_A: &[u8] = b"vault_a";
pub const SEED_VAULT_B: &[u8] = b"vault_b";

#[account]
pub struct Pool {
  
    pub bump: u8,
    pub vault_a_bump: u8,
    pub vault_b_bump: u8,

    pub treasury: Pubkey,

    pub mint_a: Pubkey, // NTC / kNite
    pub mint_b: Pubkey, // sub token

    pub vault_a: Pubkey,
    pub vault_b: Pubkey,

    pub locked: bool,

    // analytics bookkeeping 
    pub total_a: u64,
    pub total_b: u64,
}

impl Pool {
    pub fn space() -> usize {
        // disc(8)
        // bumps(3)
        // treasury(32)
        // mints(64)
        // vaults(64)
        // locked(1)
        // totals(16)
        8 + 3 + 32 + 64 + 64 + 1 + 16
    }
}
