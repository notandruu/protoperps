use serde::{Deserialize, Serialize};

use crate::state::enums::{MarketStatus, OrderType, Side};

pub const MAX_ORDERS: usize = 64;

// ── Order ─────────────────────────────────────────────────────────────────────
// repr(C) + explicit padding — deterministic memory layout, no implicit
// padding bytes, total 72 bytes (9 × 8). Same layout as original Solana program.

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[repr(C)]
pub struct Order {
    pub price: u64,
    pub size: u64,
    pub sequence_number: u64,
    pub timestamp: i64,
    pub trader: [u8; 32],
    pub active: u8,
    pub side: u8,
    pub order_type: u8,
    pub _pad: [u8; 5],
}

impl Order {
    pub fn side(&self) -> Side {
        match self.side {
            1 => Side::Short,
            _ => Side::Long,
        }
    }
    pub fn order_type(&self) -> OrderType {
        match self.order_type {
            1 => OrderType::Market,
            2 => OrderType::PostOnly,
            _ => OrderType::Limit,
        }
    }
    pub fn is_active(&self) -> bool {
        self.active != 0
    }
}

// ── Market ────────────────────────────────────────────────────────────────────
// In-memory equivalent of the on-chain Market zero-copy account.
// One instance per symbol, owned by a dedicated tokio task.

#[derive(Debug, Clone)]
pub struct Market {
    pub symbol: String,
    pub status: MarketStatus,

    // bids[0..num_bids] sorted descending by price (best bid first)
    // asks[0..num_asks] sorted ascending  by price (best ask first)
    pub bids: [Order; MAX_ORDERS],
    pub asks: [Order; MAX_ORDERS],
    pub num_bids: usize,
    pub num_asks: usize,
    pub order_sequence_number: u64,

    // market parameters
    pub tick_size: u64,
    pub lot_size: u64,
    pub max_leverage: u64,
    pub initial_margin_ratio: u64,    // bps
    pub maintenance_margin_ratio: u64, // bps
    pub liquidation_reward_bps: u64,
    pub taker_fee_bps: u64,
    pub maker_fee_bps: u64,

    // funding
    pub cumulative_funding_rate: i64,
    pub last_funding_timestamp: i64,
    pub funding_interval: i64,

    // stats
    pub open_interest: u64,
    pub volume_24h: u64,

    // oracle
    pub mark_price: u64,
    pub mark_price_updated_at: i64,
}

impl Market {
    pub fn new(symbol: &str) -> Self {
        Market {
            symbol: symbol.to_string(),
            status: MarketStatus::Active,
            bids: [Order::default(); MAX_ORDERS],
            asks: [Order::default(); MAX_ORDERS],
            num_bids: 0,
            num_asks: 0,
            order_sequence_number: 1,
            tick_size: 1,
            lot_size: 1_000_000,
            max_leverage: 500_000,    // 50x in bps
            initial_margin_ratio: 200, // 2% in bps
            maintenance_margin_ratio: 100, // 1% in bps
            liquidation_reward_bps: 500,   // 5%
            taker_fee_bps: 5,
            maker_fee_bps: 0,
            cumulative_funding_rate: 0,
            last_funding_timestamp: 0,
            funding_interval: 3600,
            open_interest: 0,
            volume_24h: 0,
            mark_price: 0,
            mark_price_updated_at: 0,
        }
    }

    pub fn effective_status(&self, now: i64) -> MarketStatus {
        let age = now.saturating_sub(self.mark_price_updated_at);
        if age > 900 {
            MarketStatus::Paused
        } else if age > 300 {
            MarketStatus::ReduceOnly
        } else {
            self.status
        }
    }
}
