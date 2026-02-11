use anchor_lang::prelude::*;

#[error_code]
pub enum MultisigError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid owners list")]
    InvalidOwners,

    #[msg("Invalid threshold")]
    InvalidThreshold,

    #[msg("Owner already exists")]
    DuplicateOwner,

    #[msg("Proposal already executed")]
    ProposalAlreadyExecuted,

    #[msg("Not enough approvals")]
    NotEnoughApprovals,

    #[msg("Too many metas")]
    TooManyMetas,

    #[msg("Instruction data too large")]
    IxDataTooLarge,

    #[msg("Account list mismatch")]
    AccountListMismatch,

    #[msg("Account meta flags mismatch (signer/writable)")]
    AccountMetaFlagsMismatch,

    #[msg("Signer meta not allowed (only multisig PDA may be signer)")]
    InvalidSignerMeta,

    #[msg("Invalid nonce")]
    InvalidNonce,

    #[msg("Owner already approved")]
    AlreadyApproved,

    #[msg("Overflow")]
    Overflow,
}
