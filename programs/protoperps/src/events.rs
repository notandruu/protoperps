use anchor_lang::prelude::*;

use crate::state::enums::{OrderType, Side};

#[event]
pub struct OrderPlaced {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub side: Side,
    pub order_type: OrderType,
    /// Order price in PRICE_PRECISION units (0 for market orders).
    pub price: u64,
    /// Total order size in LOT_PRECISION units.
    pub size: u64,
    /// How much filled immediately in this transaction.
    pub filled_size: u64,
    /// Book sequence number of the resting portion (0 if fully filled).
    pub sequence_number: u64,
}

#[event]
pub struct OrderFilled {
    pub market: Pubkey,
    /// The resting-order owner.
    pub maker: Pubkey,
    /// The crossing-order owner.
    pub taker: Pubkey,
    /// Taker's direction (Long = taker bought, Short = taker sold).
    pub side: Side,
    pub price: u64,
    pub size: u64,
    /// Maker's original order sequence number.
    pub maker_sequence_number: u64,
}

#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub base_symbol: [u8; 16],
    pub tick_size: u64,
    pub lot_size: u64,
    pub max_leverage: u64,
}

#[event]
pub struct CollateralDeposited {
    pub owner: Pubkey,
    pub amount: u64,
    pub total_deposited: u64,
}

#[event]
pub struct CollateralWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub total_deposited: u64,
}

#[event]
pub struct OrderCancelled {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub side: Side,
    pub price: u64,
    /// Remaining (unfilled) size that was cancelled.
    pub size: u64,
    pub sequence_number: u64,
}

#[event]
pub struct PositionLiquidated {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub liquidator: Pubkey,
    pub side: Side,
    /// Oracle price used to compute PnL at liquidation time.
    pub mark_price: u64,
    /// Position size that was closed (LOT_PRECISION units).
    pub size: u64,
    /// Realized PnL at liquidation (USDC_PRECISION, signed).
    pub realized_pnl: i64,
    /// Amount credited to the liquidator (USDC_PRECISION).
    pub liquidator_reward: u64,
}

#[event]
pub struct FundingUpdated {
    pub market: Pubkey,
    /// Oracle price read from the feed at update time (PRICE_PRECISION).
    pub oracle_price: u64,
    /// Orderbook midpoint supplied by the keeper (PRICE_PRECISION).
    pub mark_price: u64,
    /// Per-period funding rate applied this round (FUNDING_PRECISION, signed).
    pub funding_rate: i64,
    /// Running cumulative funding rate after this update (FUNDING_PRECISION, signed).
    pub cumulative_funding_rate: i64,
    /// Unix timestamp of this update.
    pub timestamp: i64,
}

#[event]
pub struct FundingSettled {
    pub market: Pubkey,
    pub trader: Pubkey,
    /// Net funding delta applied to the position's collateral (USDC_PRECISION, signed).
    /// Negative = trader paid funding out; positive = trader received funding.
    pub funding_delta: i64,
    /// Cumulative funding rate snapshot stored on the position after settlement.
    pub new_cumulative_funding_rate: i64,
}
