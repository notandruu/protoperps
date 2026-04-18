use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::events::FundingUpdated;
use crate::math::FUNDING_PRECISION;
use crate::state::market::Market;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateFundingParams {
    /// Current orderbook midpoint (mark price) in PRICE_PRECISION units.
    /// Supplied by the keeper; validated only to be non-zero.
    pub mark_price: u64,
}

#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    /// Permissionless: any signer may trigger a funding update.
    pub caller: Signer<'info>,

    /// The market whose cumulative funding rate is being advanced.
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    /// CHECK: Validated by `load_oracle` — owner and size verified there.
    pub oracle_feed: UncheckedAccount<'info>,
}

pub fn update_funding(ctx: Context<UpdateFunding>, params: UpdateFundingParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market_key = ctx.accounts.market.key();

    // ── Oracle validation ─────────────────────────────────────────────────────
    let oracle = crate::oracle_client::load_oracle(ctx.accounts.oracle_feed.as_ref())?;
    // Verify oracle serves this market.
    require_keys_eq!(
        Pubkey::from(oracle.market),
        market_key,
        ProtoperpsError::InvalidOracle
    );
    let oracle_status = crate::oracle_client::effective_status(&oracle, now);
    // Allow funding updates when oracle is Active or ReduceOnly; reject only on Paused.
    require!(
        oracle_status != crate::oracle_client::EffectiveOracleStatus::Paused,
        ProtoperpsError::OraclePaused
    );
    let oracle_price = oracle.price;
    require!(oracle_price > 0, ProtoperpsError::PriceZero);

    let mark_price = params.mark_price;
    require!(mark_price > 0, ProtoperpsError::PriceZero);

    let mut market = ctx.accounts.market.load_mut()?;

    // ── Funding interval guard ─────────────────────────────────────────────────
    require!(
        now >= market
            .last_funding_timestamp
            .saturating_add(market.funding_interval),
        ProtoperpsError::FundingTooEarly
    );

    // ── Per-hour funding rate ─────────────────────────────────────────────────
    //
    // funding_rate = (mark_price - oracle_price) / oracle_price * (1/24)
    //
    // Stored in FUNDING_PRECISION (1_000_000_000).
    // i128 arithmetic throughout to avoid intermediate overflow.
    let diff = (mark_price as i128).wrapping_sub(oracle_price as i128);
    let funding_rate = diff
        .checked_mul(FUNDING_PRECISION as i128)
        .ok_or(ProtoperpsError::MathOverflow)?
        .checked_div(oracle_price as i128)
        .ok_or(ProtoperpsError::DivisionByZero)?
        .checked_div(24)
        .ok_or(ProtoperpsError::DivisionByZero)?;

    let funding_rate_i64 = funding_rate as i64;

    market.cumulative_funding_rate = market
        .cumulative_funding_rate
        .checked_add(funding_rate_i64)
        .ok_or(ProtoperpsError::MathOverflow)?;
    market.last_funding_timestamp = now;

    let cfr = market.cumulative_funding_rate;
    drop(market);

    emit!(FundingUpdated {
        market: market_key,
        oracle_price,
        mark_price,
        funding_rate: funding_rate_i64,
        cumulative_funding_rate: cfr,
        timestamp: now,
    });

    Ok(())
}
