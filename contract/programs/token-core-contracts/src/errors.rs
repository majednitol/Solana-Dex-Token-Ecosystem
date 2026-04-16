use anchor_lang::prelude::*;

#[error_code]
pub enum TokenCoreError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Math overflow")]
    MathOverflow,
}
