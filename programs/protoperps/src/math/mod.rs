// math module — precision constants, margin, funding rate, and PnL helpers

pub mod pnl;
pub use pnl::{calculate_liquidation_price, calculate_margin_ratio, calculate_unrealized_pnl};

/// Price is stored in millionths of one USDC.
/// e.g. a $100,000 SpaceX share → price = 100_000 * PRICE_PRECISION
pub const PRICE_PRECISION: u64 = 1_000_000;

/// USDC on Solana uses 6 decimal places (same as PRICE_PRECISION).
pub const USDC_PRECISION: u64 = 1_000_000;

/// Position size is stored in millionths of one base lot (one synthetic contract).
pub const LOT_PRECISION: u64 = 1_000_000;

/// Margin ratios and fee rates are stored in basis points (1 bp = 0.01%).
pub const BPS_PRECISION: u64 = 10_000;

/// Funding rates are stored with 9 decimal places to retain precision across
/// many hourly accumulations.
pub const FUNDING_PRECISION: u64 = 1_000_000_000;

/// Alias kept for any code that still references MARGIN_PRECISION.
pub const MARGIN_PRECISION: u64 = BPS_PRECISION;
