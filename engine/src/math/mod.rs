pub const PRICE_PRECISION: u64 = 1_000_000;
pub const USDC_PRECISION: u64  = 1_000_000;
pub const LOT_PRECISION: u64   = 1_000_000;
pub const BPS_PRECISION: u64   = 10_000;
pub const FUNDING_PRECISION: u64 = 1_000_000_000;

use crate::errors::EngineError;

pub fn realised_pnl(
    side: crate::state::enums::Side,
    entry: u64,
    close: u64,
    size: u64,
) -> Result<i64, EngineError> {
    use crate::state::enums::Side;
    let diff: i64 = if side == Side::Long {
        (close as i64).checked_sub(entry as i64).ok_or(EngineError::MathOverflow)?
    } else {
        (entry as i64).checked_sub(close as i64).ok_or(EngineError::MathOverflow)?
    };
    let pnl = (diff as i128)
        .checked_mul(size as i128).ok_or(EngineError::MathOverflow)?
        .checked_div(LOT_PRECISION as i128).ok_or(EngineError::DivisionByZero)?;
    Ok(pnl as i64)
}

pub fn unrealized_pnl(
    side: crate::state::enums::Side,
    entry: u64,
    mark: u64,
    size: u64,
) -> Result<i64, EngineError> {
    realised_pnl(side, entry, mark, size)
}

pub fn compute_margin(price: u64, size: u64, margin_ratio_bps: u64) -> Result<u64, EngineError> {
    let notional = (price as u128)
        .checked_mul(size as u128).ok_or(EngineError::MathOverflow)?
        .checked_div(LOT_PRECISION as u128).ok_or(EngineError::DivisionByZero)?;
    let margin = notional
        .checked_mul(margin_ratio_bps as u128).ok_or(EngineError::MathOverflow)?
        .checked_div(BPS_PRECISION as u128).ok_or(EngineError::DivisionByZero)?;
    Ok(margin as u64)
}

pub fn notional_usdc(price: u64, size: u64) -> Result<u64, EngineError> {
    let n = (price as u128)
        .checked_mul(size as u128).ok_or(EngineError::MathOverflow)?
        .checked_div(LOT_PRECISION as u128).ok_or(EngineError::DivisionByZero)?;
    Ok(n as u64)
}

pub fn margin_ratio_bps(collateral: u64, upnl: i64, notional: u64) -> Result<u64, EngineError> {
    if notional == 0 {
        return Err(EngineError::DivisionByZero);
    }
    let equity = (collateral as i128)
        .checked_add(upnl as i128).ok_or(EngineError::MathOverflow)?;
    if equity <= 0 {
        return Ok(0);
    }
    let ratio = (equity as u128)
        .checked_mul(BPS_PRECISION as u128).ok_or(EngineError::MathOverflow)?
        .checked_div(notional as u128).ok_or(EngineError::DivisionByZero)?;
    Ok(ratio as u64)
}
