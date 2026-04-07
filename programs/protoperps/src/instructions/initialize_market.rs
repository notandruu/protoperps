use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::events::MarketInitialized;
use crate::math::BPS_PRECISION;
use crate::state::{Market, MARKET_SPACE};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeMarketParams {
    /// Zero-padded ASCII symbol, e.g. *b"SPACEX\0\0\0\0\0\0\0\0\0\0".
    pub base_symbol: [u8; 16],
    /// Oracle price account (set to Pubkey::default() if not yet deployed).
    pub oracle: Pubkey,
    /// Minimum price increment in PRICE_PRECISION units.
    pub tick_size: u64,
    /// Minimum size increment in LOT_PRECISION units.
    pub lot_size: u64,
    /// Maximum allowed leverage (e.g. 5 = 5×).
    pub max_leverage: u64,
    /// Initial margin ratio in BPS (e.g. 2000 = 20%).
    pub initial_margin_ratio: u64,
    /// Maintenance margin ratio in BPS (e.g. 1000 = 10%).
    pub maintenance_margin_ratio: u64,
    /// Liquidator reward as share of remaining collateral in BPS (e.g. 500 = 5%).
    pub liquidation_reward_bps: u64,
    /// Taker fee in BPS (e.g. 10 = 0.1%).
    pub taker_fee_bps: u64,
    /// Maker rebate in BPS (e.g. 5 = 0.05%).
    pub maker_fee_bps: u64,
    /// Funding settlement interval in seconds (e.g. 3600 = 1 hour).
    pub funding_interval: i64,
}

#[derive(Accounts)]
#[instruction(params: InitializeMarketParams)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = MARKET_SPACE,
        seeds = [b"market", params.base_symbol.as_ref()],
        bump,
    )]
    pub market: AccountLoader<'info, Market>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_market(
    ctx: Context<InitializeMarket>,
    params: InitializeMarketParams,
) -> Result<()> {
    // ── validate ──────────────────────────────────────────────────────────────
    require!(params.tick_size > 0, ProtoperpsError::InvalidTickSize);
    require!(params.lot_size > 0, ProtoperpsError::InvalidLotSize);
    require!(
        params.max_leverage >= 1 && params.max_leverage <= 20,
        ProtoperpsError::InvalidLeverage
    );
    require!(
        params.initial_margin_ratio > 0 && params.initial_margin_ratio <= BPS_PRECISION,
        ProtoperpsError::InvalidMarginRatio
    );
    require!(
        params.maintenance_margin_ratio > 0
            && params.maintenance_margin_ratio <= BPS_PRECISION,
        ProtoperpsError::InvalidMarginRatio
    );
    require!(
        params.initial_margin_ratio > params.maintenance_margin_ratio,
        ProtoperpsError::MarginRatioConflict
    );
    require!(
        params.liquidation_reward_bps > 0,
        ProtoperpsError::InvalidLiquidationReward
    );
    require!(
        params.funding_interval > 0,
        ProtoperpsError::InvalidFundingInterval
    );

    // capture keys before borrowing AccountLoader
    let market_key = ctx.accounts.market.key();
    let authority_key = ctx.accounts.authority.key();
    let bump = ctx.bumps.market;

    // ── mutate ────────────────────────────────────────────────────────────────
    {
        let mut market = ctx.accounts.market.load_init()?;
        market.bump = bump;
        market.status = 0; // MarketStatus::Active
        market.authority = authority_key;
        market.oracle = params.oracle;
        market.base_symbol = params.base_symbol;
        market.order_sequence_number = 0;
        market.num_bids = 0;
        market.num_asks = 0;
        market.tick_size = params.tick_size;
        market.lot_size = params.lot_size;
        market.max_leverage = params.max_leverage;
        market.initial_margin_ratio = params.initial_margin_ratio;
        market.maintenance_margin_ratio = params.maintenance_margin_ratio;
        market.liquidation_reward_bps = params.liquidation_reward_bps;
        market.taker_fee_bps = params.taker_fee_bps;
        market.maker_fee_bps = params.maker_fee_bps;
        market.cumulative_funding_rate = 0;
        market.last_funding_timestamp = Clock::get()?.unix_timestamp;
        market.funding_interval = params.funding_interval;
        market.open_interest = 0;
        market.volume_24h = 0;
    }

    // ── emit ──────────────────────────────────────────────────────────────────
    emit!(MarketInitialized {
        market: market_key,
        authority: authority_key,
        base_symbol: params.base_symbol,
        tick_size: params.tick_size,
        lot_size: params.lot_size,
        max_leverage: params.max_leverage,
    });

    Ok(())
}
