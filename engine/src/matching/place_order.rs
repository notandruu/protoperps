use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::errors::EngineError;
use crate::math::{compute_margin, notional_usdc, realised_pnl, BPS_PRECISION, LOT_PRECISION};
use crate::state::enums::{MarketStatus, OrderType, Side};
use crate::state::margin::MarginAccount;
use crate::state::market::{Market, Order, MAX_ORDERS};
use crate::state::position::Position;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderParams {
    pub trader: String,
    pub market: String,
    pub side: Side,
    pub order_type: OrderType,
    pub price: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fill {
    pub maker: String,
    pub price: u64,
    pub size: u64,
    pub maker_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderResult {
    pub fills: Vec<Fill>,
    pub resting_seq: Option<u64>,
    pub filled_size: u64,
    pub remaining_size: u64,
}

pub fn place_order(
    params: &PlaceOrderParams,
    market: &mut Market,
    taker_margin: &mut MarginAccount,
    taker_position: &mut Position,
    maker_positions: &mut std::collections::HashMap<String, Position>,
) -> Result<PlaceOrderResult, EngineError> {
    if params.size == 0 {
        return Err(EngineError::SizeZero);
    }
    if params.order_type != OrderType::Market && params.price == 0 {
        return Err(EngineError::PriceZero);
    }

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;

    let status = market.effective_status(now);
    if status != MarketStatus::Active {
        return Err(EngineError::MarketNotActive);
    }

    // PostOnly: reject immediately if it would cross.
    if params.order_type == OrderType::PostOnly && check_would_cross(market, params) {
        return Err(EngineError::PostOnlyWouldCross);
    }

    let init_margin_ratio = market.initial_margin_ratio;
    let cfr = market.cumulative_funding_rate;

    // ── matching loop (up to 16 fills) ────────────────────────────────────────
    let mut fills: Vec<Fill> = Vec::with_capacity(16);
    let mut remaining_size = params.size;

    while remaining_size > 0 {
        match match_one(market, params, remaining_size, &params.trader)? {
            Some((maker, price, size, seq)) => {
                remaining_size -= size;
                fills.push(Fill { maker, price, size, maker_seq: seq });
            }
            None => break,
        }
    }

    if params.order_type == OrderType::Market && fills.is_empty() {
        return Err(EngineError::MarketOrderNoFill);
    }

    // ── insert resting remainder ───────────────────────────────────────────────
    let resting_seq = if remaining_size > 0 && params.order_type != OrderType::Market {
        let seq = market.order_sequence_number;
        market.order_sequence_number = market.order_sequence_number.saturating_add(1);

        let new_order = Order {
            price: params.price,
            size: remaining_size,
            sequence_number: seq,
            timestamp: now,
            trader: trader_to_bytes(&params.trader),
            active: 1,
            side: params.side.to_u8(),
            order_type: params.order_type.to_u8(),
            _pad: [0u8; 5],
        };

        if params.side == Side::Long {
            insert_bid(market, new_order)?;
        } else {
            insert_ask(market, new_order)?;
        }
        Some(seq)
    } else {
        None
    };

    // ── update market stats ────────────────────────────────────────────────────
    for fill in &fills {
        let notional = notional_usdc(fill.price, fill.size)?;
        market.volume_24h = market.volume_24h.saturating_add(notional);
        market.open_interest = market.open_interest.saturating_add(fill.size);
    }

    // ── compute and lock required taker margin ─────────────────────────────────
    let filled_size = params.size - remaining_size;
    let required_margin = if fills.is_empty() && remaining_size > 0 {
        compute_margin(params.price, params.size, init_margin_ratio)?
    } else if remaining_size == 0 {
        let avg = average_fill_price(&fills);
        compute_margin(avg, filled_size, init_margin_ratio)?
    } else {
        let avg = average_fill_price(&fills);
        let fm = compute_margin(avg, filled_size, init_margin_ratio)?;
        let rm = compute_margin(params.price, remaining_size, init_margin_ratio)?;
        fm.checked_add(rm).ok_or(EngineError::MathOverflow)?
    };

    if taker_margin.free_collateral() < required_margin {
        return Err(EngineError::InsufficientMargin);
    }
    taker_margin.usdc_locked = taker_margin
        .usdc_locked
        .checked_add(required_margin)
        .ok_or(EngineError::MathOverflow)?;

    // ── update taker position ──────────────────────────────────────────────────
    if taker_position.size == 0 && taker_position.last_funding_rate == 0 {
        taker_position.last_funding_rate = cfr;
        taker_position.side = params.side;
    }
    for fill in &fills {
        update_position(taker_position, params.side, fill.price, fill.size)?;
        let fill_margin = compute_margin(fill.price, fill.size, init_margin_ratio)?;
        taker_position.collateral = taker_position
            .collateral
            .checked_add(fill_margin)
            .ok_or(EngineError::MathOverflow)?;
    }

    // ── update maker positions ─────────────────────────────────────────────────
    let maker_side = params.side.opposite();
    for fill in &fills {
        if let Some(pos) = maker_positions.get_mut(&fill.maker) {
            if pos.size == 0 && pos.last_funding_rate == 0 {
                pos.last_funding_rate = cfr;
            }
            update_position(pos, maker_side, fill.price, fill.size)?;
            let fill_margin = compute_margin(fill.price, fill.size, init_margin_ratio)?;
            pos.collateral = pos
                .collateral
                .checked_add(fill_margin)
                .ok_or(EngineError::MathOverflow)?;
        }
    }

    Ok(PlaceOrderResult { fills, resting_seq, filled_size, remaining_size })
}

// ── Matching engine helpers ────────────────────────────────────────────────────

fn check_would_cross(market: &Market, params: &PlaceOrderParams) -> bool {
    match params.side {
        Side::Long => {
            market.num_asks > 0
                && market.asks[0].is_active()
                && market.asks[0].price <= params.price
        }
        Side::Short => {
            market.num_bids > 0
                && market.bids[0].is_active()
                && market.bids[0].price >= params.price
        }
    }
}

fn match_one(
    market: &mut Market,
    params: &PlaceOrderParams,
    remaining: u64,
    taker: &str,
) -> Result<Option<(String, u64, u64, u64)>, EngineError> {
    let is_market = params.order_type == OrderType::Market;
    let taker_bytes = trader_to_bytes(taker);

    match params.side {
        Side::Long => {
            if market.num_asks == 0 || !market.asks[0].is_active() {
                return Ok(None);
            }
            let ask = market.asks[0];
            if !is_market && ask.price > params.price {
                return Ok(None);
            }
            if ask.trader == taker_bytes {
                return Ok(None); // self-trade prevention
            }
            let fill_price = ask.price;
            let fill_size = remaining.min(ask.size);
            let maker = bytes_to_trader(&ask.trader);
            let seq = ask.sequence_number;

            if fill_size == ask.size {
                remove_from_asks(market, 0);
            } else {
                market.asks[0].size -= fill_size;
            }
            Ok(Some((maker, fill_price, fill_size, seq)))
        }
        Side::Short => {
            if market.num_bids == 0 || !market.bids[0].is_active() {
                return Ok(None);
            }
            let bid = market.bids[0];
            if !is_market && bid.price < params.price {
                return Ok(None);
            }
            if bid.trader == taker_bytes {
                return Ok(None);
            }
            let fill_price = bid.price;
            let fill_size = remaining.min(bid.size);
            let maker = bytes_to_trader(&bid.trader);
            let seq = bid.sequence_number;

            if fill_size == bid.size {
                remove_from_bids(market, 0);
            } else {
                market.bids[0].size -= fill_size;
            }
            Ok(Some((maker, fill_price, fill_size, seq)))
        }
    }
}

pub fn insert_bid(market: &mut Market, order: Order) -> Result<(), EngineError> {
    if market.num_bids >= MAX_ORDERS {
        return Err(EngineError::OrderBookFull);
    }
    let n = market.num_bids;
    let pos = (0..n)
        .find(|&i| {
            market.bids[i].price < order.price
                || (market.bids[i].price == order.price
                    && market.bids[i].sequence_number > order.sequence_number)
        })
        .unwrap_or(n);
    let mut i = n;
    while i > pos {
        market.bids[i] = market.bids[i - 1];
        i -= 1;
    }
    market.bids[pos] = order;
    market.num_bids += 1;
    Ok(())
}

pub fn insert_ask(market: &mut Market, order: Order) -> Result<(), EngineError> {
    if market.num_asks >= MAX_ORDERS {
        return Err(EngineError::OrderBookFull);
    }
    let n = market.num_asks;
    let pos = (0..n)
        .find(|&i| {
            market.asks[i].price > order.price
                || (market.asks[i].price == order.price
                    && market.asks[i].sequence_number > order.sequence_number)
        })
        .unwrap_or(n);
    let mut i = n;
    while i > pos {
        market.asks[i] = market.asks[i - 1];
        i -= 1;
    }
    market.asks[pos] = order;
    market.num_asks += 1;
    Ok(())
}

fn remove_from_bids(market: &mut Market, idx: usize) {
    let n = market.num_bids;
    for i in idx..n.saturating_sub(1) {
        market.bids[i] = market.bids[i + 1];
    }
    if market.num_bids > 0 {
        market.num_bids -= 1;
    }
}

fn remove_from_asks(market: &mut Market, idx: usize) {
    let n = market.num_asks;
    for i in idx..n.saturating_sub(1) {
        market.asks[i] = market.asks[i + 1];
    }
    if market.num_asks > 0 {
        market.num_asks -= 1;
    }
}

fn update_position(
    pos: &mut Position,
    order_side: Side,
    fill_price: u64,
    fill_size: u64,
) -> Result<(), EngineError> {
    if pos.size == 0 {
        pos.side = order_side;
        pos.entry_price = fill_price;
        pos.size = fill_size;
    } else if pos.side == order_side {
        let new_size = (pos.size as u128)
            .checked_add(fill_size as u128)
            .ok_or(EngineError::MathOverflow)?;
        let vwap = ((pos.size as u128)
            .checked_mul(pos.entry_price as u128).ok_or(EngineError::MathOverflow)?
            .checked_add(
                (fill_size as u128)
                    .checked_mul(fill_price as u128).ok_or(EngineError::MathOverflow)?,
            ).ok_or(EngineError::MathOverflow)?)
        .checked_div(new_size).ok_or(EngineError::DivisionByZero)?;
        pos.size = new_size as u64;
        pos.entry_price = vwap as u64;
    } else {
        if fill_size < pos.size {
            let pnl = realised_pnl(pos.side, pos.entry_price, fill_price, fill_size)?;
            pos.realized_pnl = pos.realized_pnl.checked_add(pnl).ok_or(EngineError::MathOverflow)?;
            pos.size -= fill_size;
        } else if fill_size == pos.size {
            let pnl = realised_pnl(pos.side, pos.entry_price, fill_price, fill_size)?;
            pos.realized_pnl = pos.realized_pnl.checked_add(pnl).ok_or(EngineError::MathOverflow)?;
            pos.size = 0;
            pos.entry_price = 0;
        } else {
            let close_size = pos.size;
            let new_open = fill_size - close_size;
            let pnl = realised_pnl(pos.side, pos.entry_price, fill_price, close_size)?;
            pos.realized_pnl = pos.realized_pnl.checked_add(pnl).ok_or(EngineError::MathOverflow)?;
            pos.side = order_side;
            pos.entry_price = fill_price;
            pos.size = new_open;
        }
    }
    Ok(())
}

fn average_fill_price(fills: &[Fill]) -> u64 {
    if fills.is_empty() {
        return 0;
    }
    let mut total_notional: u128 = 0;
    let mut total_size: u128 = 0;
    for f in fills {
        total_notional += f.price as u128 * f.size as u128;
        total_size += f.size as u128;
    }
    if total_size == 0 { 0 } else { (total_notional / total_size) as u64 }
}

pub fn trader_to_bytes(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    let b = s.as_bytes();
    let len = b.len().min(32);
    out[..len].copy_from_slice(&b[..len]);
    out
}

fn bytes_to_trader(b: &[u8; 32]) -> String {
    let end = b.iter().position(|&x| x == 0).unwrap_or(32);
    String::from_utf8_lossy(&b[..end]).to_string()
}
