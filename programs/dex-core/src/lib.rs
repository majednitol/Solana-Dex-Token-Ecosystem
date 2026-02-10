use anchor_lang::prelude::*;

// Program ID
declare_id!("EKxbxCKrMseRkptPv1EVUgTv1uBW4WuSbvtrm6miwYLk");

#[program]
pub mod dex_core_contracts {
    use super::*;

    // Hello world function
    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("Hello, world!");
        Ok(())
    }
}


#[derive(Accounts)]
pub struct Initialize {}
