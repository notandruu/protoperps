use anchor_lang::prelude::*;

use crate::state::enums::{MarketStatus, OrderType, Side};

/// Hard cap on bids and asks stored in the Market account.
/// 64/side → account is ~9.4 KB, under the 10 KB CPI create_account limit.
pub const MAX_ORDERS: usize = 64;

// ── Order ──────────────────────────────────────────────────────────────────
//
// Market holds [Order; 128] × 2 sides ≈ 18 KB of orderbook data.
// Deserialising that with borsh would create a ~9 KB stack frame — the SBF
// limit is 4 096 bytes, so the program would be rejected at deploy time.
//
// Solution: make Order a zero-copy type (bytemuck::Pod).  The whole Market is
// accessed via AccountLoader which memory-maps the account data directly;
// no per-element stack allocation occurs.
//
// Zero-copy rules:
//   • #[repr(C)] — deterministic field layout
//   • every field must implement bytemuck::Pod
//   • NO implicit padding — every padding byte must be explicit
//
// Layout (#[repr(C)], struct align = 8):
//   offset  0: price             u64  (8)
//   offset  8: size              u64  (8)
//   offset 16: sequence_number   u64  (8)
//   offset 24: timestamp         i64  (8)
//   offset 32: trader            [u8;32]  (32) ← Pubkey, align 1
//   offset 64: active            u8   (1)
//   offset 65: side              u8   (1)  ← Side as u8
//   offset 66: order_type        u8   (1)  ← OrderType as u8
//   offset 67: _pad              [u8;5] (5) ← explicit: total 72 = 9×8 ✓
//
// Invariant: `active == 0` means the slot is free.

#[zero_copy]
pub struct Order {
    /// Price in ticks (PRICE_PRECISION units).
    pub price: u64,
    /// Remaining unfilled size in base lots (LOT_PRECISION units).
    pub size: u64,
    /// Monotonically increasing per-market counter; used as tiebreaker.
    pub sequence_number: u64,
    /// Unix timestamp when the order was placed (seconds).
    pub timestamp: i64,
    /// Wallet that placed this order.
    pub trader: Pubkey,
    /// 0 = inactive (slot free), 1 = active (live order).
    pub active: u8,
    /// Side encoded as u8: 0 = Long, 1 = Short.  Use Order::side() accessor.
    pub side: u8,
    /// OrderType encoded as u8: 0 = Limit, 1 = Market, 2 = PostOnly.
    pub order_type: u8,
    /// Explicit padding — keeps struct size a multiple of 8 (no implicit padding).
    pub _pad: [u8; 5],
}

impl Order {
    /// Decode the side field into the typed enum.
    pub fn side(&self) -> Side {
        match self.side {
            1 => Side::Short,
            _ => Side::Long,
        }
    }

    /// Decode the order_type field into the typed enum.
    pub fn order_type(&self) -> OrderType {
        match self.order_type {
            1 => OrderType::Market,
            2 => OrderType::PostOnly,
            _ => OrderType::Limit,
        }
    }

    /// Returns true if this slot holds a live order.
    pub fn is_active(&self) -> bool {
        self.active != 0
    }
}

// ── Market ─────────────────────────────────────────────────────────────────
//
// Zero-copy account accessed via AccountLoader<'info, Market> in instruction
// contexts.  Instructions call market.load()? or market.load_mut()? to get a
// typed reference — no heap or stack copy is created.
//
// Layout (#[repr(C)], struct align = 8, total 9 424 bytes):
//
//   offset     field
//        0     bump                u8
//        1     status              u8
//        2     _pad0               [u8;6]    → 8
//        8     authority           Pubkey    → 40
//       40     oracle              Pubkey    → 72
//       72     base_symbol         [u8;16]   → 88
//       88     bids        [Order;64]=4608   → 4696
//     4696     asks        [Order;64]=4608   → 9304
//     9304     order_sequence_number u64     → 9312
//     9312     num_bids            u8
//     9313     num_asks            u8
//     9314     _pad1               [u8;6]    → 9320
//     9320–9383  8 × u64 params (64 bytes)
//     9384     cumulative_funding_rate i64
//     9392     last_funding_timestamp  i64
//     9400     funding_interval        i64
//     9408     open_interest           u64
//     9416     volume_24h              u64
//     9424     (end)
//
// + 8 byte Anchor discriminator = 9 432 bytes on-chain (< 10 240 CPI limit)
//
// PDA seeds: ["market", base_symbol_bytes]

#[account(zero_copy)]
pub struct Market {
    pub bump: u8,
    /// MarketStatus as u8: 0=Active, 1=ReduceOnly, 2=Paused.
    pub status: u8,
    pub _pad0: [u8; 6],

    pub authority: Pubkey,
    pub oracle: Pubkey,
    /// Zero-padded ASCII symbol, e.g. b"SPACEX\0\0\0\0\0\0\0\0\0\0".
    pub base_symbol: [u8; 16],

    // ── orderbook ──────────────────────────────────────────────────────────
    // Invariant maintained by the matching engine:
    //   bids[0..num_bids]  sorted descending by price (best bid first)
    //   asks[0..num_asks]  sorted ascending  by price (best ask first)
    // Slots at index >= count are zeroed / inactive.
    pub bids: [Order; MAX_ORDERS],
    pub asks: [Order; MAX_ORDERS],
    pub order_sequence_number: u64,
    pub num_bids: u8,
    pub num_asks: u8,
    pub _pad1: [u8; 6],

    // ── market parameters ──────────────────────────────────────────────────
    pub tick_size: u64,
    pub lot_size: u64,
    pub max_leverage: u64,
    pub initial_margin_ratio: u64,
    pub maintenance_margin_ratio: u64,
    pub liquidation_reward_bps: u64,
    pub taker_fee_bps: u64,
    pub maker_fee_bps: u64,

    // ── funding ────────────────────────────────────────────────────────────
    // Running sum of hourly funding rates (FUNDING_PRECISION, signed).
    // i64 gives ~9.22e18 headroom; at 10%/hr max, overflows after ~10^7 years.
    pub cumulative_funding_rate: i64,
    pub last_funding_timestamp: i64,
    pub funding_interval: i64,

    // ── stats ──────────────────────────────────────────────────────────────
    pub open_interest: u64,
    pub volume_24h: u64,
}

/// Total on-chain bytes for a Market account (8-byte discriminator included).
pub const MARKET_SPACE: usize = 8 + std::mem::size_of::<Market>();

impl Market {
    /// Decode the status field into the typed enum.
    pub fn status(&self) -> MarketStatus {
        match self.status {
            1 => MarketStatus::ReduceOnly,
            2 => MarketStatus::Paused,
            _ => MarketStatus::Active,
        }
    }

    /// Return the base symbol as a UTF-8 str, trimming zero padding.
    pub fn symbol(&self) -> &str {
        let end = self.base_symbol.iter().position(|&b| b == 0).unwrap_or(16);
        core::str::from_utf8(&self.base_symbol[..end]).unwrap_or("?")
    }
}
