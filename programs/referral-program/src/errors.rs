use anchor_lang::prelude::*;

#[error_code]
pub enum ReferralError {
    #[msg("Unauthorized caller")]
    Unauthorized,

    #[msg("Invalid user")]
    InvalidUser,

    #[msg("Invalid referrer")]
    InvalidReferrer,

    #[msg("Cannot refer yourself")]
    SelfReferralNotAllowed,

    #[msg("Config already initialized")]
    AlreadyInitialized,

    #[msg("Invalid config")]
    InvalidConfig,

    #[msg("Dex program mismatch")]
    DexProgramMismatch,
}
