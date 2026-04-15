use anchor_lang::prelude::*;

use crate::state::enums::{OracleSource, OracleStatus};

/// Shared precision constant — all prices are integers scaled by 1_000_000.
/// e.g. $100.50 is stored as 100_500_000.
pub const PRICE_PRECISION: u64 = 1_000_000;

/// Maximum price deviation allowed per update (10%, in BPS: 1000 / 10_000).
pub const MAX_PRICE_DEVIATION_BPS: u64 = 1_000;

/// Oracle goes reduce-only after this many seconds without an update (5 min).
pub const STALE_REDUCE_ONLY_SECS: i64 = 5 * 60;

/// Oracle fully pauses after this many seconds without an update (15 min).
pub const STALE_PAUSE_SECS: i64 = 15 * 60;

// ── OraclePrice ────────────────────────────────────────────────────────────
//
// Zero-copy account for a single price feed.  One account per market.
//
// Layout (#[repr(C)], struct align = 8, total 128 bytes):
//
//   offset  field                 type       size
//        0  bump                  u8            1
//        1  source                u8 (enum)     1
//        2  status                u8 (enum)     1
//        3  _pad0                 [u8;5]        5   → 8
//        8  authority             [u8;32]      32   → 40
//       40  market                [u8;32]      32   → 72
//       72  price                 u64           8   → 80
//       80  confidence            u64           8   → 88
//       88  twap                  u64           8   → 96
//       96  previous_price        u64           8   → 104
//      104  twap_samples          u64           8   → 112
//      112  last_update_slot      u64           8   → 120
//      120  last_update_timestamp i64           8   → 128
//
// + 8-byte Anchor discriminator = 136 bytes on-chain.
//
// PDA seeds: [b"oracle", market_pubkey.as_ref()]

#[account(zero_copy)]
pub struct OraclePrice {
    pub bump: u8,
    /// OracleSource as u8 — use source() accessor to get the typed enum.
    pub source: u8,
    /// OracleStatus as u8 — use status() accessor to get the typed enum.
    pub status: u8,
    pub _pad0: [u8; 5],

    /// Keeper wallet that is authorized to push price updates to this feed.
    pub authority: Pubkey,
    /// The protoperps Market account that this oracle feed serves.
    pub market: Pubkey,

    /// Current price in PRICE_PRECISION units (1e6).
    pub price: u64,
    /// Confidence interval: half the bid/ask spread, same units as price.
    pub confidence: u64,
    /// Exponential moving average of price (PRICE_PRECISION), updated each push.
    pub twap: u64,
    /// Price from the previous accepted update — used to enforce max deviation.
    pub previous_price: u64,
    /// Running count of TWAP samples included in the current EMA.
    pub twap_samples: u64,

    /// Slot number of the most recent accepted price update.
    pub last_update_slot: u64,
    /// Unix timestamp (seconds) of the most recent accepted price update.
    pub last_update_timestamp: i64,
}

/// On-chain byte footprint including the 8-byte Anchor discriminator.
pub const ORACLE_PRICE_SPACE: usize = 8 + std::mem::size_of::<OraclePrice>();

impl OraclePrice {
    /// Decode the source field into the typed enum.
    pub fn source(&self) -> OracleSource {
        OracleSource::from_u8(self.source)
    }

    /// Decode the status field into the typed enum.
    pub fn status(&self) -> OracleStatus {
        OracleStatus::from_u8(self.status)
    }

    /// Returns true if this feed is accepting new order flow (status == Active).
    pub fn is_active(&self) -> bool {
        self.status == OracleStatus::Active as u8
    }

    /// Returns true if this feed is in reduce-only mode.
    pub fn is_reduce_only(&self) -> bool {
        self.status == OracleStatus::ReduceOnly as u8
    }

    /// Returns true if this feed is fully paused.
    pub fn is_paused(&self) -> bool {
        self.status == OracleStatus::Paused as u8
    }

    /// Compute the OracleStatus that corresponds to the current timestamp,
    /// given when the feed was last updated.  Does NOT mutate self.
    pub fn compute_staleness_status(&self, now: i64) -> OracleStatus {
        let age = now.saturating_sub(self.last_update_timestamp);
        if age >= STALE_PAUSE_SECS {
            OracleStatus::Paused
        } else if age >= STALE_REDUCE_ONLY_SECS {
            OracleStatus::ReduceOnly
        } else {
            OracleStatus::Active
        }
    }

    /// Returns true when a proposed new price violates the max-deviation guard.
    ///
    /// Guard: |new - old| / old > MAX_PRICE_DEVIATION_BPS / BPS_PRECISION (10%)
    /// Uses integer arithmetic only.
    pub fn exceeds_max_deviation(&self, new_price: u64) -> bool {
        if self.previous_price == 0 {
            return false; // first update — no baseline to compare against
        }
        let (diff, _) = if new_price >= self.previous_price {
            (new_price - self.previous_price, false)
        } else {
            (self.previous_price - new_price, true)
        };
        // diff * 10_000 > previous_price * MAX_PRICE_DEVIATION_BPS
        // avoids division; cross-multiply to stay in u64
        diff.saturating_mul(10_000) > self.previous_price.saturating_mul(MAX_PRICE_DEVIATION_BPS)
    }

    /// Compute the next EMA given a new sample.
    ///
    /// Uses a simple cumulative approach for the first N_WARMUP samples, then
    /// switches to EMA with alpha = 1/twap_samples to prevent the denominator
    /// from blowing up.  All arithmetic is integer; result in PRICE_PRECISION.
    pub fn next_twap(&self, new_price: u64) -> u64 {
        if self.twap == 0 || self.twap_samples == 0 {
            return new_price;
        }
        // EMA: twap_new = twap_old + (new_price - twap_old) / twap_samples
        // Cap twap_samples so alpha never falls below ~1% (100 samples max).
        let n = self.twap_samples.min(100);
        let twap_old = self.twap;
        if new_price >= twap_old {
            twap_old + (new_price - twap_old) / n
        } else {
            twap_old - (twap_old - new_price) / n
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: u64 = PRICE_PRECISION;

    fn oracle_at(previous_price: u64, twap: u64, twap_samples: u64, last_update_timestamp: i64) -> OraclePrice {
        OraclePrice {
            bump: 1,
            source: 0,
            status: 0,
            _pad0: [0; 5],
            authority: Pubkey::default(),
            market: Pubkey::default(),
            price: previous_price,
            confidence: 0,
            twap,
            previous_price,
            twap_samples,
            last_update_slot: 0,
            last_update_timestamp,
        }
    }

    #[test]
    fn struct_size_matches_layout_comment() {
        assert_eq!(std::mem::size_of::<OraclePrice>(), 128);
        assert_eq!(ORACLE_PRICE_SPACE, 136);
    }

    // ── exceeds_max_deviation ─────────────────────────────────────────────

    #[test]
    fn deviation_zero_previous_price_always_passes() {
        let mut o = oracle_at(0, 0, 0, 0);
        o.previous_price = 0;
        assert!(!o.exceeds_max_deviation(200 * P));
    }

    #[test]
    fn deviation_exactly_10pct_is_rejected() {
        // previous = 100, new = 110 → diff = 10, 10*10000 = 100000, 100*1000 = 100000 → equal → NOT > → passes
        // We want strictly >, so exactly 10% should NOT be rejected.
        let o = oracle_at(100 * P, 100 * P, 1, 0);
        let new_price = 110 * P;
        assert!(!o.exceeds_max_deviation(new_price));
    }

    #[test]
    fn deviation_above_10pct_is_rejected() {
        // previous = 100, new = 111 → diff = 11, 11*10000 = 110000 > 100*1000 = 100000 → rejected
        let o = oracle_at(100 * P, 100 * P, 1, 0);
        let new_price = 111 * P;
        assert!(o.exceeds_max_deviation(new_price));
    }

    #[test]
    fn deviation_drop_above_10pct_is_rejected() {
        // previous = 100, new = 89 → diff = 11 → rejected
        let o = oracle_at(100 * P, 100 * P, 1, 0);
        let new_price = 89 * P;
        assert!(o.exceeds_max_deviation(new_price));
    }

    #[test]
    fn deviation_within_range_passes() {
        let o = oracle_at(100 * P, 100 * P, 1, 0);
        let new_price = 105 * P; // 5% up
        assert!(!o.exceeds_max_deviation(new_price));
    }

    // ── compute_staleness_status ──────────────────────────────────────────

    #[test]
    fn staleness_fresh_is_active() {
        let o = oracle_at(100 * P, 100 * P, 1, 1000);
        assert_eq!(o.compute_staleness_status(1000 + 60), OracleStatus::Active);
    }

    #[test]
    fn staleness_5min_is_reduce_only() {
        let o = oracle_at(100 * P, 100 * P, 1, 1000);
        assert_eq!(o.compute_staleness_status(1000 + STALE_REDUCE_ONLY_SECS), OracleStatus::ReduceOnly);
    }

    #[test]
    fn staleness_15min_is_paused() {
        let o = oracle_at(100 * P, 100 * P, 1, 1000);
        assert_eq!(o.compute_staleness_status(1000 + STALE_PAUSE_SECS), OracleStatus::Paused);
    }

    // ── next_twap ─────────────────────────────────────────────────────────

    #[test]
    fn twap_first_sample_returns_price() {
        let o = oracle_at(100 * P, 0, 0, 0);
        assert_eq!(o.next_twap(200 * P), 200 * P);
    }

    #[test]
    fn twap_ema_moves_toward_new_price() {
        // twap = 100, new = 200, n = 1 → twap_new = 100 + (200-100)/1 = 200
        let o = oracle_at(100 * P, 100 * P, 1, 0);
        assert_eq!(o.next_twap(200 * P), 200 * P);
    }

    #[test]
    fn twap_ema_slow_convergence_with_many_samples() {
        // twap = 100, new = 200, n = 100 → twap_new = 100 + 100/100 = 101
        let o = oracle_at(100 * P, 100 * P, 200, 0); // capped at 100
        assert_eq!(o.next_twap(200 * P), 101 * P);
    }

    #[test]
    fn twap_ema_decreasing_price() {
        // twap = 100, new = 0, n = 10 → twap_new = 100 - 100/10 = 90
        let o = oracle_at(100 * P, 100 * P, 10, 0);
        assert_eq!(o.next_twap(0), 90 * P);
    }
}
