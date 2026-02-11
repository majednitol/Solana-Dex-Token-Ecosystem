use anchor_lang::prelude::*;

#[error_code]
pub enum TokenCoreError {
    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Amount too small after applying fee")]
    AmountTooSmallForFee,

    #[msg("Treasury ATA is invalid (must be ATA(treasury, mint))")]
    InvalidTreasuryAta,

    #[msg("Mint mismatch")]
    MintMismatch,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Mint authority already renounced")]
    AlreadyRenounced,

    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid config PDA")]
     InvalidConfigPda,

}
