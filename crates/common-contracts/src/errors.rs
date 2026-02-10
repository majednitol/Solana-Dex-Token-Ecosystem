// programs/common/src/errors.rs
use anchor_lang::prelude::*;

/// Shared error codes across all programs.
/// Keep these stable. Auditors will reference them.
#[error_code]
pub enum CommonError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid argument")]
    InvalidArgument,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Math overflow/underflow")]
    MathOverflow,

    #[msg("Slippage exceeded")]
    SlippageExceeded,

    #[msg("Token/mint mismatch")]
    MintMismatch,

    #[msg("Token account owner mismatch")]
    TokenOwnerMismatch,

    #[msg("Invalid PDA / seeds")]
    InvalidPda,

    #[msg("Token not allowed (whitelist violation)")]
    TokenNotAllowed,

    #[msg("Operation not permitted (locked)")]
    Locked,

    #[msg("Duplicate action")]
    Duplicate,

    #[msg("Invalid signer")]
    InvalidSigner,

    #[msg("Invalid program id")]
    InvalidProgramId,

    #[msg("Account is not initialized")]
    Uninitialized,
}
