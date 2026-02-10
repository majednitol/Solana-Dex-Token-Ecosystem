pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;


declare_id!("EKxbxCKrMseRkptPv1EVUgTv1uBW4WuSbvtrm6miwYLj");

#[program]
pub mod knite_solana_contracts {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
