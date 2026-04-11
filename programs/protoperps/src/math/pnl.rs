use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::math::BPS_PRECISION;
use crate::state::enums::Side;

// ── Public helpers ─────────────────────────────────────────────────────────

/// Unrealized PnL in USDC_PRECISION for an open position.
///
/// Long:  pnl = (current_price - entry_price) * size / price_precision
/// Short: pnl = (entry_price - current_price) * size / price_precision
///
/// `price_precision` should equal LOT_PRECISION (both are 1_000_000 in this
/// program — passing it explicitly keeps the function self-contained and
/// testable without depending on the module constant).
///
/// Returns 0 when `size == 0`.
pub fn calculate_unrealized_pnl(
    entry_price: u64,
    current_price: u64,
    size: u64,
    side: Side,
    price_precision: u64,
) -> Result<i64> {
    require!(price_precision > 0, ProtoperpsError::DivisionByZero);

    if size == 0 {
        return Ok(0);
    }

    let price_diff: i64 = match side {
        Side::Long => (current_price as i64)
            .checked_sub(entry_price as i64)
            .ok_or(error!(ProtoperpsError::MathOverflow))?,
        Side::Short => (entry_price as i64)
            .checked_sub(current_price as i64)
            .ok_or(error!(ProtoperpsError::MathOverflow))?,
    };

    // Use i128 to avoid overflow on large positions.
    let pnl = (price_diff as i128)
        .checked_mul(size as i128)
        .ok_or(error!(ProtoperpsError::MathOverflow))?
        .checked_div(price_precision as i128)
        .ok_or(error!(ProtoperpsError::DivisionByZero))?;

    Ok(pnl as i64)
}

/// Current margin ratio in basis points for an open position.
///
/// equity              = collateral + unrealized_pnl  (clamped to 0 if negative)
/// margin_ratio (BPS)  = equity * BPS_PRECISION / position_notional
///
/// Returns 0 when `position_notional == 0` or equity <= 0 (fully insolvent).
pub fn calculate_margin_ratio(
    collateral: u64,
    unrealized_pnl: i64,
    position_notional: u64,
) -> Result<u64> {
    if position_notional == 0 {
        return Ok(0);
    }

    let equity: i128 = (collateral as i128)
        .checked_add(unrealized_pnl as i128)
        .ok_or(error!(ProtoperpsError::MathOverflow))?;

    if equity <= 0 {
        return Ok(0);
    }

    let ratio = (equity as u128)
        .checked_mul(BPS_PRECISION as u128)
        .ok_or(error!(ProtoperpsError::MathOverflow))?
        .checked_div(position_notional as u128)
        .ok_or(error!(ProtoperpsError::DivisionByZero))?;

    Ok(ratio as u64)
}

/// Liquidation price in PRICE_PRECISION at which margin_ratio first drops to
/// (or below) `maintenance_margin_ratio`.
///
/// Derivation (let P_e = entry_price, S = size, C = collateral, L = price_precision,
/// M = maintenance_margin_ratio, B = BPS_PRECISION):
///
/// At liq, equity = M/B * notional:
///
///   Long:   C + (P_liq - P_e)*S/L = M/B * P_liq*S/L
///           P_liq = (entry_notional - C) * B * L / (S * (B - M))
///
///   Short:  C + (P_e - P_liq)*S/L = M/B * P_liq*S/L
///           P_liq = (entry_notional + C) * B * L / (S * (B + M))
///
/// Returns 0 for `size == 0` or when a long is so well-collateralised that
/// it cannot be liquidated above price 0.
pub fn calculate_liquidation_price(
    entry_price: u64,
    collateral: u64,
    size: u64,
    side: Side,
    maintenance_margin_ratio: u64,
    price_precision: u64,
) -> Result<u64> {
    require!(price_precision > 0, ProtoperpsError::DivisionByZero);

    if size == 0 {
        return Ok(0);
    }

    // entry_notional = entry_price * size / price_precision (in USDC_PRECISION)
    let entry_notional = (entry_price as u128)
        .checked_mul(size as u128)
        .ok_or(error!(ProtoperpsError::MathOverflow))?
        .checked_div(price_precision as u128)
        .ok_or(error!(ProtoperpsError::DivisionByZero))?;

    match side {
        Side::Long => {
            // P_liq = (entry_notional - C) * B * L / (S * (B - M))
            // If C >= entry_notional, the position cannot be liquidated above 0.
            if entry_notional <= collateral as u128 {
                return Ok(0);
            }

            let bps_minus_maint = (BPS_PRECISION as u128)
                .checked_sub(maintenance_margin_ratio as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?;
            require!(bps_minus_maint > 0, ProtoperpsError::DivisionByZero);

            let numerator = entry_notional
                .checked_sub(collateral as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?
                .checked_mul(BPS_PRECISION as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?
                .checked_mul(price_precision as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?;

            let denominator = (size as u128)
                .checked_mul(bps_minus_maint)
                .ok_or(error!(ProtoperpsError::MathOverflow))?;

            let liq_price = numerator
                .checked_div(denominator)
                .ok_or(error!(ProtoperpsError::DivisionByZero))?;

            Ok(liq_price as u64)
        }
        Side::Short => {
            // P_liq = (entry_notional + C) * B * L / (S * (B + M))
            let bps_plus_maint = (BPS_PRECISION as u128)
                .checked_add(maintenance_margin_ratio as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?;

            let numerator = entry_notional
                .checked_add(collateral as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?
                .checked_mul(BPS_PRECISION as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?
                .checked_mul(price_precision as u128)
                .ok_or(error!(ProtoperpsError::MathOverflow))?;

            let denominator = (size as u128)
                .checked_mul(bps_plus_maint)
                .ok_or(error!(ProtoperpsError::MathOverflow))?;

            let liq_price = numerator
                .checked_div(denominator)
                .ok_or(error!(ProtoperpsError::DivisionByZero))?;

            Ok(liq_price as u64)
        }
    }
}

// ── Unit tests ─────────────────────────────────────────────────────────────
//
// Precision constants used throughout (mirrors math::mod.rs values):
//   PRICE_PRECISION = LOT_PRECISION = USDC_PRECISION = 1_000_000
//   BPS_PRECISION = 10_000
//
// Scenario: entry $100, size 1 lot, collateral $20 (20% initial margin),
//           maintenance 10% (1000 bps).
//
//   Long  liq price  ≈ $88.888 888  (formula gives 88_888_888, floor)
//   Short liq price  ≈ $109.090 909 (formula gives 109_090_909, floor)

#[cfg(test)]
mod tests {
    use super::*;

    // Shorthand for test values.
    const P: u64 = 1_000_000; // 1 unit of PRICE_PRECISION / USDC_PRECISION / LOT_PRECISION

    // Standard scenario
    const ENTRY: u64 = 100 * P;       // $100
    const SIZE: u64 = P;              // 1 lot
    const COLLATERAL: u64 = 20 * P;  // $20 (20% initial margin)
    const MAINT: u64 = 1_000;         // 10% in BPS

    // ── calculate_unrealized_pnl ──────────────────────────────────────────

    #[test]
    fn long_in_profit() {
        let current = 110 * P; // up $10
        let pnl = calculate_unrealized_pnl(ENTRY, current, SIZE, Side::Long, P).unwrap();
        // (110 - 100) * 1_000_000 / 1_000_000 = 10_000_000 ($10)
        assert_eq!(pnl, 10 * P as i64);
    }

    #[test]
    fn long_in_loss() {
        let current = 90 * P; // down $10
        let pnl = calculate_unrealized_pnl(ENTRY, current, SIZE, Side::Long, P).unwrap();
        assert_eq!(pnl, -(10 * P as i64));
    }

    #[test]
    fn short_in_profit() {
        let current = 90 * P; // price fell $10 — short wins
        let pnl = calculate_unrealized_pnl(ENTRY, current, SIZE, Side::Short, P).unwrap();
        assert_eq!(pnl, 10 * P as i64);
    }

    #[test]
    fn short_in_loss() {
        let current = 110 * P; // price rose $10 — short loses
        let pnl = calculate_unrealized_pnl(ENTRY, current, SIZE, Side::Short, P).unwrap();
        assert_eq!(pnl, -(10 * P as i64));
    }

    #[test]
    fn zero_size_pnl() {
        // Any price, any side: zero size → zero PnL.
        let pnl_long =
            calculate_unrealized_pnl(ENTRY, 999 * P, 0, Side::Long, P).unwrap();
        let pnl_short =
            calculate_unrealized_pnl(ENTRY, 1 * P, 0, Side::Short, P).unwrap();
        assert_eq!(pnl_long, 0);
        assert_eq!(pnl_short, 0);
    }

    #[test]
    fn pnl_at_entry_is_zero() {
        let pnl_long =
            calculate_unrealized_pnl(ENTRY, ENTRY, SIZE, Side::Long, P).unwrap();
        let pnl_short =
            calculate_unrealized_pnl(ENTRY, ENTRY, SIZE, Side::Short, P).unwrap();
        assert_eq!(pnl_long, 0);
        assert_eq!(pnl_short, 0);
    }

    // ── calculate_margin_ratio ────────────────────────────────────────────

    #[test]
    fn margin_ratio_profitable_long() {
        // Long, price at $110: unrealized_pnl = $10, notional = $110.
        // equity = $30, ratio = 30/110 * 10000 = 2727 bps.
        let upnl: i64 = 10 * P as i64;
        let notional: u64 = 110 * P;
        let ratio = calculate_margin_ratio(COLLATERAL, upnl, notional).unwrap();
        // 30_000_000 * 10_000 / 110_000_000 = 2727
        assert_eq!(ratio, 2_727);
    }

    #[test]
    fn margin_ratio_losing_long() {
        // Long, price at $90: unrealized_pnl = -$10, notional = $90.
        // equity = $10, ratio = 10/90 * 10000 = 1111 bps.
        let upnl: i64 = -(10 * P as i64);
        let notional: u64 = 90 * P;
        let ratio = calculate_margin_ratio(COLLATERAL, upnl, notional).unwrap();
        assert_eq!(ratio, 1_111);
    }

    #[test]
    fn margin_ratio_zero_notional_returns_zero() {
        let ratio = calculate_margin_ratio(COLLATERAL, 0, 0).unwrap();
        assert_eq!(ratio, 0);
    }

    #[test]
    fn margin_ratio_fully_insolvent_returns_zero() {
        // unrealized_pnl so negative it wipes out collateral.
        let upnl: i64 = -(25 * P as i64); // -$25 on $20 collateral
        let ratio = calculate_margin_ratio(COLLATERAL, upnl, 75 * P).unwrap();
        assert_eq!(ratio, 0);
    }

    // ── calculate_liquidation_price ───────────────────────────────────────

    #[test]
    fn long_liquidation_price() {
        // Long at $100, $20 collateral, 10% maintenance.
        // P_liq = (100M - 20M) * 10000 * 1M / (1M * 9000) = 88_888_888.
        let liq = calculate_liquidation_price(ENTRY, COLLATERAL, SIZE, Side::Long, MAINT, P)
            .unwrap();
        assert_eq!(liq, 88_888_888);
    }

    #[test]
    fn short_liquidation_price() {
        // Short at $100, $20 collateral, 10% maintenance.
        // P_liq = (100M + 20M) * 10000 * 1M / (1M * 11000) = 109_090_909.
        let liq = calculate_liquidation_price(ENTRY, COLLATERAL, SIZE, Side::Short, MAINT, P)
            .unwrap();
        assert_eq!(liq, 109_090_909);
    }

    #[test]
    fn zero_size_liquidation_price_is_zero() {
        let liq_long =
            calculate_liquidation_price(ENTRY, COLLATERAL, 0, Side::Long, MAINT, P).unwrap();
        let liq_short =
            calculate_liquidation_price(ENTRY, COLLATERAL, 0, Side::Short, MAINT, P).unwrap();
        assert_eq!(liq_long, 0);
        assert_eq!(liq_short, 0);
    }

    #[test]
    fn overcollateralised_long_returns_zero() {
        // Collateral > full notional — cannot be liquidated above $0.
        let fat_collateral = 200 * P; // $200 > $100 notional
        let liq =
            calculate_liquidation_price(ENTRY, fat_collateral, SIZE, Side::Long, MAINT, P)
                .unwrap();
        assert_eq!(liq, 0);
    }

    /// Integration: verify the three functions are consistent.
    ///
    /// At the computed liq price, margin_ratio must be <= maintenance.
    /// At liq_price + 1, margin_ratio must be >= maintenance.
    #[test]
    fn position_exactly_at_liquidation_threshold_long() {
        let liq_price =
            calculate_liquidation_price(ENTRY, COLLATERAL, SIZE, Side::Long, MAINT, P)
                .unwrap();
        // liq_price = 88_888_888 (floor)

        // At the liquidation price, margin_ratio should be < maintenance (position is under).
        let upnl_at_liq =
            calculate_unrealized_pnl(ENTRY, liq_price, SIZE, Side::Long, P).unwrap();
        let notional_at_liq = (liq_price as u128 * SIZE as u128 / P as u128) as u64;
        let ratio_at_liq =
            calculate_margin_ratio(COLLATERAL, upnl_at_liq, notional_at_liq).unwrap();
        assert!(
            ratio_at_liq <= MAINT,
            "ratio {} should be <= maint {} at liq price",
            ratio_at_liq,
            MAINT
        );

        // One tick above: margin_ratio should be >= maintenance (position is healthy).
        let above_liq = liq_price + 1;
        let upnl_above =
            calculate_unrealized_pnl(ENTRY, above_liq, SIZE, Side::Long, P).unwrap();
        let notional_above = (above_liq as u128 * SIZE as u128 / P as u128) as u64;
        let ratio_above =
            calculate_margin_ratio(COLLATERAL, upnl_above, notional_above).unwrap();
        assert!(
            ratio_above >= MAINT,
            "ratio {} should be >= maint {} one tick above liq",
            ratio_above,
            MAINT
        );
    }

    #[test]
    fn position_exactly_at_liquidation_threshold_short() {
        let liq_price =
            calculate_liquidation_price(ENTRY, COLLATERAL, SIZE, Side::Short, MAINT, P)
                .unwrap();
        // liq_price = 109_090_909 (floor)

        // At the liquidation price, margin_ratio should be <= maintenance.
        let upnl_at_liq =
            calculate_unrealized_pnl(ENTRY, liq_price, SIZE, Side::Short, P).unwrap();
        let notional_at_liq = (liq_price as u128 * SIZE as u128 / P as u128) as u64;
        let ratio_at_liq =
            calculate_margin_ratio(COLLATERAL, upnl_at_liq, notional_at_liq).unwrap();
        assert!(
            ratio_at_liq <= MAINT,
            "ratio {} should be <= maint {} at liq price (short)",
            ratio_at_liq,
            MAINT
        );

        // One tick below liq price: position should be healthy.
        let below_liq = liq_price - 1;
        let upnl_below =
            calculate_unrealized_pnl(ENTRY, below_liq, SIZE, Side::Short, P).unwrap();
        let notional_below = (below_liq as u128 * SIZE as u128 / P as u128) as u64;
        let ratio_below =
            calculate_margin_ratio(COLLATERAL, upnl_below, notional_below).unwrap();
        assert!(
            ratio_below >= MAINT,
            "ratio {} should be >= maint {} one tick below liq (short)",
            ratio_below,
            MAINT
        );
    }
}
