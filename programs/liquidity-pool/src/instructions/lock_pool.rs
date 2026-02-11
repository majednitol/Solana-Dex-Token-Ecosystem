use anchor_lang::prelude::*;

use crate::{LockPool, PoolLocked};
use crate::errors::PoolError;

pub fn handler(ctx: Context<LockPool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    if ctx.accounts.treasury_signer.key() != pool.treasury {
        return err!(PoolError::Unauthorized);
    }

    if pool.locked {
        return err!(PoolError::PoolAlreadyLocked);
    }

    pool.locked = true;

    emit!(PoolLocked {
        pool: pool.key(),
        treasury: pool.treasury,
    });

    Ok(())
}
