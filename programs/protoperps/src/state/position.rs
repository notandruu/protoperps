use anchor_lang::prelude::*;

use crate::state::enums::Side;

/// Open perpetual position for one (trader, market) pair.
///
/// Isolated margin: every position holds its own USDC collateral.
/// There is no cross-margin in v1 — each position stands alone.
///
/// PDA seeds: ["position", market, trader]
///
/// Space (including 8-byte Anchor discriminator):
///   8 + Position::INIT_SPACE  (see POSITION_SPACE below)
#[account]
#[derive(InitSpace)]
pub struct Position {
    /// PDA bump seed.
    pub bump: u8,
    /// The market this position belongs to.
    pub market: Pubkey,
    /// Wallet that owns this position.
    pub trader: Pubkey,
    /// Long or Short.
    pub side: Side,

    /// Open size in base lots (LOT_PRECISION units).
    /// Zero when the position is fully closed.
    pub size: u64,

    /// Volume-weighted average entry price in ticks (PRICE_PRECISION units).
    /// Updated on every partial fill that increases the position.
    pub entry_price: u64,

    /// USDC locked as isolated margin for this position (USDC_PRECISION units).
    /// Released (minus fees and funding) when the position is closed or liquidated.
    pub collateral: u64,

    /// Snapshot of Market::cumulative_funding_rate at the last funding settlement.
    ///
    /// Unsettled funding owed = (market.cumulative_funding_rate - last_funding_rate)
    ///                          * size / FUNDING_PRECISION
    ///
    /// Positive delta → long pays short; negative delta → short pays long.
    /// i64 matches Market::cumulative_funding_rate (same type, same precision).
    pub last_funding_rate: i64,

    /// Cumulative realized PnL in USDC (USDC_PRECISION units), signed.
    /// Accrues on each partial close and on funding settlements.
    pub realized_pnl: i64,
}

/// Total on-chain bytes for a Position account (discriminator included).
pub const POSITION_SPACE: usize = 8 + Position::INIT_SPACE;

impl Position {
    /// Returns `true` when there is no open size (closed or never opened).
    pub fn is_closed(&self) -> bool {
        self.size == 0
    }
}
