use anchor_lang::prelude::*;

pub const SEED_TOKEN_REGISTRY: &[u8] = b"token_registry";
pub const MAX_TOKENS: usize = 50;

#[account]
pub struct TokenRegistry {
    pub bump: u8,
    pub authority: Pubkey,
    pub count: u8,
    pub mints: [Pubkey; MAX_TOKENS],
}

impl TokenRegistry {
    pub fn space() -> usize {
        8 + 1 + 32 + 1 + (32 * MAX_TOKENS)
    }
}
