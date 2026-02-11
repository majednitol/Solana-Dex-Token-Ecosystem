use anchor_lang::prelude::*;

pub const SEED_TOKEN_CONFIG: &[u8] = b"token_config";

#[account]
pub struct TokenConfig {
    pub bump: u8,
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub decimals: u8,
    pub tax_bps: u16,     // 5 bps = 0.05%
    pub renounced: bool,  // once true -> no minting possible
}

impl TokenConfig {
    pub fn space() -> usize {
        // disc(8)
        // bump(1)
        // mint(32)
        // treasury(32)
        // decimals(1)
        // tax_bps(2)
        // renounced(1)
        8 + 1 + 32 + 32 + 1 + 2 + 1
    }
}
