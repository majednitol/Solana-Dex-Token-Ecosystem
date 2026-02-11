use anchor_lang::prelude::*;

#[error_code]
pub enum DexError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Mint mismatch")]
    MintMismatch,

    #[msg("Token not allowed for this pair")]
    TokenNotAllowed,

    #[msg("Slippage limit exceeded")]
    SlippageExceeded,

    #[msg("Pair is disabled / not ready")]
    PairDisabled,

    #[msg("Treasury ATA is invalid")]
    InvalidTreasuryAta,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
}
