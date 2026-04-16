use anchor_lang::prelude::*;

use crate::errors::OracleError;
use crate::events::FeedInitialized;
use crate::state::{OraclePrice, OracleStatus, ORACLE_PRICE_SPACE};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeFeedParams {
    /// Starting price in PRICE_PRECISION units. Must be > 0.
    pub initial_price: u64,
    /// Initial confidence interval (half-spread), same units as price.
    pub confidence: u64,
    /// OracleSource as u8: 0 = DEXPool, 1 = SecondaryMarket, 2 = FundingRound.
    pub source: u8,
}

#[derive(Accounts)]
pub struct InitializeFeed<'info> {
    /// Keeper wallet that will be the sole authorized updater for this feed.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The protoperps Market account this feed serves.
    /// Only the key is used — no data is read.
    /// CHECK: used only as a PDA seed; no data is accessed.
    pub market: UncheckedAccount<'info>,

    /// Oracle price feed account — one per market.
    /// PDA seeds: ["oracle", market.key()]
    #[account(
        init,
        payer = authority,
        space = ORACLE_PRICE_SPACE,
        seeds = [b"oracle", market.key().as_ref()],
        bump,
    )]
    pub oracle: AccountLoader<'info, OraclePrice>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_feed(
    ctx: Context<InitializeFeed>,
    params: InitializeFeedParams,
) -> Result<()> {
    require!(params.initial_price > 0, OracleError::ZeroPrice);

    let market_key = ctx.accounts.market.key();
    let authority_key = ctx.accounts.authority.key();
    let oracle_key = ctx.accounts.oracle.key();
    let bump = ctx.bumps.oracle;
    let clock = Clock::get()?;

    {
        let mut feed = ctx.accounts.oracle.load_init()?;
        feed.bump = bump;
        feed.source = params.source;
        feed.status = OracleStatus::Active as u8;
        feed.authority = authority_key;
        feed.market = market_key;
        feed.price = params.initial_price;
        feed.confidence = params.confidence;
        feed.twap = params.initial_price;
        feed.previous_price = params.initial_price;
        feed.twap_samples = 1;
        feed.last_update_slot = clock.slot;
        feed.last_update_timestamp = clock.unix_timestamp;
    }

    emit!(FeedInitialized {
        oracle: oracle_key,
        market: market_key,
        authority: authority_key,
        initial_price: params.initial_price,
        source: params.source,
    });

    Ok(())
}
