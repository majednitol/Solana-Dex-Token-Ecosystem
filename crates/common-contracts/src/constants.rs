use anchor_lang::prelude::Pubkey;

/// ========= Economics =========
/// Transfer tax: 0.05% = 5 basis points
pub const TRANSFER_TAX_BPS: u16 = 5;

/// Swap fee: 0.3% = 30 basis points
pub const SWAP_FEE_BPS: u16 = 30;

/// Purchase fee: 1% = 100 basis points
pub const PURCHASE_FEE_BPS: u16 = 100;

/// Basis points denominator (100% = 10_000 bps)
pub const BPS_DENOMINATOR: u64 = 10_000;


/// IMPORTANT: Changing seeds changes PDA addresses permanently.
pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_POOL: &[u8] = b"pool";
pub const SEED_PAIR: &[u8] = b"pair";
pub const SEED_REFERRAL: &[u8] = b"referral";
pub const SEED_WHITELIST: &[u8] = b"whitelist";

/// ========= Defaults / limits =========
pub const MAX_IX_ACCOUNTS: usize = 64;

/// Utility constant for “zero pubkey” checks.
pub const ZERO_PUBKEY_BYTES: [u8; 32] = [0u8; 32];

#[inline(always)]
pub fn is_zero_pubkey(pk: &Pubkey) -> bool {
    pk.to_bytes() == ZERO_PUBKEY_BYTES
}
