use anchor_lang::prelude::*;

use crate::errors::OracleError;
use crate::events::FeedPaused;
use crate::state::{OraclePrice, OracleStatus};

#[derive(Accounts)]
pub struct AdminPause<'info> {
    /// Must match the authority stored in the OraclePrice account.
    pub authority: Signer<'info>,

    /// CHECK: used only as a PDA seed; no data is accessed.
    pub market: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"oracle", market.key().as_ref()],
        bump,
    )]
    pub oracle: AccountLoader<'info, OraclePrice>,
}

pub fn admin_pause(ctx: Context<AdminPause>) -> Result<()> {
    let oracle_key = ctx.accounts.oracle.key();

    let mut feed = ctx.accounts.oracle.load_mut()?;

    // ── access control ────────────────────────────────────────────────────────
    require_keys_eq!(
        feed.authority,
        ctx.accounts.authority.key(),
        OracleError::UnauthorizedKeeper
    );

    let market_key = feed.market;

    feed.status = OracleStatus::Paused as u8;

    drop(feed);

    emit!(FeedPaused {
        oracle: oracle_key,
        market: market_key,
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
