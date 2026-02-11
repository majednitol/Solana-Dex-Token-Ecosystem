use anchor_lang::prelude::*;

pub const SEED_REFERRAL_CONFIG: &[u8] = b"referral_config";
pub const SEED_REFERRAL_MARKER: &[u8] = b"referral_marker";

#[account]
pub struct ReferralConfig {
    pub bump: u8,
    pub initialized: bool,


    pub allowed_dex_program: Pubkey,
    pub treasury: Pubkey,
}

impl ReferralConfig {
    pub fn space() -> usize {
        // disc(8) + bump(1) + initialized(1) + allowed(32) + treasury(32)
        8 + 1 + 1 + 32 + 32
    }
}

#[account]
pub struct RefereeState {
    pub bump: u8,
    pub user: Pubkey,
    pub referrer: Pubkey,
    pub pair: Pubkey,     // informational / analytics
    pub recorded_at: i64,
}

impl RefereeState {
    pub fn space() -> usize {
        // disc(8) + bump(1) + user(32) + referrer(32) + pair(32) + ts(8)
        8 + 1 + 32 + 32 + 32 + 8
    }
}
