use anchor_lang::prelude::*;

#[error_code]
pub enum PoolError {
    #[msg("Unauthorized: only treasury can perform this action")]
    Unauthorized,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Pool already locked")]
    PoolAlreadyLocked,

    #[msg("Pool not locked")]
    PoolNotLocked,

    #[msg("Mint A and Mint B must be different")]
    SameMint,

    #[msg("Mint mismatch")]
    MintMismatch,

    #[msg("Vault mismatch (passed vault does not match pool state)")]
    VaultMismatch,

    #[msg("Invalid vault authority (vault token account owner must be the pool PDA)")]
    InvalidVaultAuthority,

    #[msg("Math overflow")]
    MathOverflow,
}
