use crate::errors::EngineError;
use crate::math::{margin_ratio_bps, notional_usdc, unrealized_pnl, BPS_PRECISION};
use crate::state::margin::MarginAccount;
use crate::state::market::Market;
use crate::state::position::Position;

#[derive(Debug)]
pub struct LiquidateResult {
    pub realized_pnl: i64,
    pub liquidator_reward: u64,
}

pub fn liquidate(
    market: &Market,
    position: &mut Position,
    trader_margin: &mut MarginAccount,
    liquidator_margin: &mut MarginAccount,
) -> Result<LiquidateResult, EngineError> {
    if position.is_closed() {
        return Err(EngineError::PositionNotOpen);
    }

    let mark_price = market.mark_price;
    if mark_price == 0 {
        return Err(EngineError::PriceZero);
    }

    let upnl = unrealized_pnl(position.side, position.entry_price, mark_price, position.size)?;
    let notional = notional_usdc(mark_price, position.size)?;
    let ratio = margin_ratio_bps(position.collateral, upnl, notional)?;

    if ratio >= market.maintenance_margin_ratio {
        return Err(EngineError::NotLiquidatable);
    }

    let equity: i128 = (position.collateral as i128)
        .checked_add(upnl as i128)
        .ok_or(EngineError::MathOverflow)?;

    // Close position
    let position_collateral = position.collateral;
    position.realized_pnl = position.realized_pnl
        .checked_add(upnl)
        .ok_or(EngineError::MathOverflow)?;
    position.size = 0;
    position.entry_price = 0;
    position.collateral = 0;

    // Release locked margin
    trader_margin.usdc_locked = trader_margin.usdc_locked.saturating_sub(position_collateral);

    // Apply PnL
    if upnl < 0 {
        trader_margin.usdc_deposited =
            trader_margin.usdc_deposited.saturating_sub((-upnl) as u64);
    } else if upnl > 0 {
        trader_margin.usdc_deposited = trader_margin
            .usdc_deposited
            .checked_add(upnl as u64)
            .ok_or(EngineError::MathOverflow)?;
    }

    // Liquidator reward
    let liquidator_reward = if equity > 0 {
        let reward = (equity as u128)
            .checked_mul(market.liquidation_reward_bps as u128).ok_or(EngineError::MathOverflow)?
            .checked_div(BPS_PRECISION as u128).ok_or(EngineError::DivisionByZero)?
            as u64;
        trader_margin.usdc_deposited = trader_margin.usdc_deposited.saturating_sub(reward);
        liquidator_margin.usdc_deposited = liquidator_margin
            .usdc_deposited
            .checked_add(reward)
            .ok_or(EngineError::MathOverflow)?;
        reward
    } else {
        0
    };

    Ok(LiquidateResult { realized_pnl: upnl, liquidator_reward })
}
