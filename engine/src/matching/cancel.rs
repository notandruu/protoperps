use crate::errors::EngineError;
use crate::state::market::Market;

/// Remove an order from the book. Returns the order's size (freed margin).
pub fn cancel_order(
    market: &mut Market,
    trader: &str,
    sequence_number: u64,
) -> Result<u64, EngineError> {
    let trader_bytes = super::place_order::trader_to_bytes(trader);

    // Check bids
    for i in 0..market.num_bids {
        let o = &market.bids[i];
        if o.is_active() && o.trader == trader_bytes && o.sequence_number == sequence_number {
            let freed_size = o.size;
            remove_bid(market, i);
            return Ok(freed_size);
        }
    }

    // Check asks
    for i in 0..market.num_asks {
        let o = &market.asks[i];
        if o.is_active() && o.trader == trader_bytes && o.sequence_number == sequence_number {
            let freed_size = o.size;
            remove_ask(market, i);
            return Ok(freed_size);
        }
    }

    Err(EngineError::PositionNotOpen)
}

fn remove_bid(market: &mut Market, idx: usize) {
    let n = market.num_bids;
    for i in idx..n.saturating_sub(1) {
        market.bids[i] = market.bids[i + 1];
    }
    if market.num_bids > 0 { market.num_bids -= 1; }
}

fn remove_ask(market: &mut Market, idx: usize) {
    let n = market.num_asks;
    for i in idx..n.saturating_sub(1) {
        market.asks[i] = market.asks[i + 1];
    }
    if market.num_asks > 0 { market.num_asks -= 1; }
}
