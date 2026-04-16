use anchor_lang::prelude::*;

use crate::errors::OracleError;
use crate::events::PriceUpdated;
use crate::state::{OraclePrice, OracleStatus};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdatePriceParams {
    /// New price in PRICE_PRECISION units. Must be > 0.
    pub price: u64,
    /// Updated confidence interval (half-spread), same units as price.
    pub confidence: u64,
    /// OracleSource as u8: 0 = DEXPool, 1 = SecondaryMarket, 2 = FundingRound.
    pub source: u8,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
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

pub fn update_price(ctx: Context<UpdatePrice>, params: UpdatePriceParams) -> Result<()> {
    require!(params.price > 0, OracleError::ZeroPrice);

    let oracle_key = ctx.accounts.oracle.key();
    let clock = Clock::get()?;

    let mut feed = ctx.accounts.oracle.load_mut()?;

    // ── access control ────────────────────────────────────────────────────────
    require_keys_eq!(
        feed.authority,
        ctx.accounts.authority.key(),
        OracleError::UnauthorizedKeeper
    );

    // ── max-deviation guard ───────────────────────────────────────────────────
    require!(
        !feed.exceeds_max_deviation(params.price),
        OracleError::PriceDeviationTooLarge
    );

    // ── compute new TWAP before mutating fields ───────────────────────────────
    let new_twap = feed.next_twap(params.price);

    // Capture for event emission after the borrow is released.
    let market_key = feed.market;

    // ── mutate ────────────────────────────────────────────────────────────────
    feed.previous_price = feed.price;
    feed.price = params.price;
    feed.confidence = params.confidence;
    feed.source = params.source;
    feed.twap = new_twap;
    feed.twap_samples = feed.twap_samples.saturating_add(1);
    // A successful update means the feed is fresh — always Active afterward.
    feed.status = OracleStatus::Active as u8;
    feed.last_update_slot = clock.slot;
    feed.last_update_timestamp = clock.unix_timestamp;

    drop(feed); // release borrow before emit

    // ── emit ──────────────────────────────────────────────────────────────────
    emit!(PriceUpdated {
        oracle: oracle_key,
        market: market_key,
        price: params.price,
        twap: new_twap,
        confidence: params.confidence,
        source: params.source,
        status: OracleStatus::Active as u8,
    });

    Ok(())
}
