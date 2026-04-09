use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize};

use crate::errors::ProtoperpsError;
use crate::events::{OrderFilled, OrderPlaced};
use crate::math::{BPS_PRECISION, LOT_PRECISION};
use crate::state::enums::{MarketStatus, OrderType, Side};
use crate::state::margin::MarginAccount;
use crate::state::market::{Market, Order, MAX_ORDERS};
use crate::state::position::{Position, POSITION_SPACE};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlaceOrderParams {
    pub side: Side,
    pub order_type: OrderType,
    /// Price in PRICE_PRECISION units. Ignored (set 0) for Market orders.
    pub price: u64,
    /// Size in LOT_PRECISION units.
    pub size: u64,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    /// The perpetual market to trade.
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    /// Taker's open position for this market. Created on first order.
    #[account(
        init_if_needed,
        payer = taker,
        space = POSITION_SPACE,
        seeds = [b"position", market.key().as_ref(), taker.key().as_ref()],
        bump,
    )]
    pub taker_position: Account<'info, Position>,

    /// Taker's margin account (must exist; created via deposit_collateral).
    #[account(
        mut,
        seeds = [b"margin", taker.key().as_ref()],
        bump = taker_margin.bump,
    )]
    pub taker_margin: Account<'info, MarginAccount>,

    pub system_program: Program<'info, System>,

    /// CHECK: Validated by `load_oracle` — owner == ORACLE_PROGRAM_ID and size ≥ mirror.
    /// The oracle PDA for this market; must have status Active for new orders to proceed.
    pub oracle_feed: UncheckedAccount<'info>,
    // remaining_accounts: one maker Position PDA per fill, in match order.
    // All must be pre-created (makers called place_order before to get on the book).
}

// ── Fill record (stack-allocated, no heap) ─────────────────────────────────

struct FillRecord {
    maker: Pubkey,
    price: u64,
    size: u64,
    maker_seq: u64,
}

// ── Main handler ───────────────────────────────────────────────────────────

pub fn place_order(ctx: Context<PlaceOrder>, params: PlaceOrderParams) -> Result<()> {
    // ── validate ──────────────────────────────────────────────────────────────
    require!(params.size > 0, ProtoperpsError::SizeZero);
    if params.order_type != OrderType::Market {
        require!(params.price > 0, ProtoperpsError::PriceZero);
    }

    let market_key = ctx.accounts.market.key();
    let taker_key = ctx.accounts.taker.key();

    // ── Oracle check: Active feed required to place new orders ────────────────
    {
        let now = Clock::get()?.unix_timestamp;
        let oracle = crate::oracle_client::load_oracle(ctx.accounts.oracle_feed.as_ref())?;
        // Confirm this oracle serves the requested market.
        require_keys_eq!(
            Pubkey::from(oracle.market),
            market_key,
            ProtoperpsError::InvalidOracle
        );
        require!(
            crate::oracle_client::effective_status(&oracle, now)
                == crate::oracle_client::EffectiveOracleStatus::Active,
            ProtoperpsError::OracleNotActive
        );
    }

    // ── matching phase ─────────────────────────────────────────────────────────
    // Stack-allocated fill records (max 5 fills per transaction).
    let mut fills = [
        FillRecord { maker: Pubkey::default(), price: 0, size: 0, maker_seq: 0 },
        FillRecord { maker: Pubkey::default(), price: 0, size: 0, maker_seq: 0 },
        FillRecord { maker: Pubkey::default(), price: 0, size: 0, maker_seq: 0 },
        FillRecord { maker: Pubkey::default(), price: 0, size: 0, maker_seq: 0 },
        FillRecord { maker: Pubkey::default(), price: 0, size: 0, maker_seq: 0 },
    ];
    let mut fill_count: usize = 0;
    let mut remaining_size = params.size;

    // Capture values we'll need after the market borrow ends.
    let init_margin_ratio: u64;
    let cfr: i64; // cumulative_funding_rate snapshot for new positions
    let resting_seq: u64; // sequence number assigned to any resting order

    {
        let mut market = ctx.accounts.market.load_mut()?;

        // ── market health checks ───────────────────────────────────────────────
        require!(market.status() == MarketStatus::Active, ProtoperpsError::MarketNotActive);

        // PostOnly: reject immediately if it would cross.
        if params.order_type == OrderType::PostOnly {
            let would_cross = check_would_cross(&market, &params);
            require!(!would_cross, ProtoperpsError::PostOnlyWouldCross);
        }

        init_margin_ratio = market.initial_margin_ratio;
        cfr = market.cumulative_funding_rate;

        let max_fills = ctx.remaining_accounts.len().min(5);

        // ── matching loop ──────────────────────────────────────────────────────
        while remaining_size > 0 && fill_count < max_fills {
            match match_one(
                &mut market,
                &params,
                remaining_size,
                taker_key,
            )? {
                Some((maker, price, size, seq)) => {
                    remaining_size -= size;
                    fills[fill_count] = FillRecord { maker, price, size, maker_seq: seq };
                    fill_count += 1;
                }
                None => break,
            }
        }

        // Market orders must fill at least partially.
        if params.order_type == OrderType::Market {
            require!(fill_count > 0, ProtoperpsError::MarketOrderNoFill);
        }

        // ── insert resting remainder ───────────────────────────────────────────
        if remaining_size > 0 && params.order_type != OrderType::Market {
            let seq = market.order_sequence_number;
            market.order_sequence_number = market.order_sequence_number.saturating_add(1);
            resting_seq = seq;

            let new_order = Order {
                price: params.price,
                size: remaining_size,
                sequence_number: seq,
                timestamp: Clock::get()?.unix_timestamp,
                trader: taker_key,
                active: 1,
                side: params.side.to_u8(),
                order_type: params.order_type.to_u8(),
                _pad: [0u8; 5],
            };

            if params.side == Side::Long {
                insert_bid(&mut market, new_order)?;
            } else {
                insert_ask(&mut market, new_order)?;
            }
        } else {
            resting_seq = 0;
        }

        // ── update market stats ────────────────────────────────────────────────
        for i in 0..fill_count {
            let notional = notional_usdc(fills[i].price, fills[i].size)?;
            market.volume_24h = market.volume_24h.saturating_add(notional);
            // Open interest: track net new longs/shorts added
            // Simplified: increment by fill_size (close-side reduces it, handled later)
            market.open_interest = market.open_interest.saturating_add(fills[i].size);
        }
    }
    // market borrow released here.

    // ── compute required taker margin ─────────────────────────────────────────
    // Use order_price for unfilled resting part; average fill price for filled part.
    let filled_size = params.size - remaining_size;
    let required_margin = if filled_size == 0 && remaining_size > 0 {
        // Pure resting limit order
        compute_margin(params.price, params.size, init_margin_ratio)?
    } else if remaining_size == 0 {
        // Fully matched
        let avg_price = average_fill_price(&fills, fill_count)?;
        compute_margin(avg_price, filled_size, init_margin_ratio)?
    } else {
        // Partially matched + resting remainder
        let avg_price = average_fill_price(&fills, fill_count)?;
        let filled_margin = compute_margin(avg_price, filled_size, init_margin_ratio)?;
        let resting_margin = compute_margin(params.price, remaining_size, init_margin_ratio)?;
        filled_margin.checked_add(resting_margin).ok_or(ProtoperpsError::MathOverflow)?
    };

    // ── check and lock taker margin ───────────────────────────────────────────
    {
        let taker_margin = &mut ctx.accounts.taker_margin;
        require!(
            taker_margin.free_collateral() >= required_margin,
            ProtoperpsError::InsufficientMargin
        );
        taker_margin.usdc_locked = taker_margin
            .usdc_locked
            .checked_add(required_margin)
            .ok_or(ProtoperpsError::MathOverflow)?;
    }

    // ── update taker position ─────────────────────────────────────────────────
    {
        let pos = &mut ctx.accounts.taker_position;
        if pos.market == Pubkey::default() {
            pos.bump = ctx.bumps.taker_position;
            pos.market = market_key;
            pos.trader = taker_key;
            pos.side = params.side;
            pos.last_funding_rate = cfr;
        }
        for i in 0..fill_count {
            update_position(pos, params.side, fills[i].price, fills[i].size)?;
            // Accumulate locked margin as position collateral for the filled portion.
            let fill_margin = compute_margin(fills[i].price, fills[i].size, init_margin_ratio)?;
            pos.collateral = pos
                .collateral
                .checked_add(fill_margin)
                .ok_or(ProtoperpsError::MathOverflow)?;
        }
    }

    // ── update maker positions from remaining_accounts ─────────────────────────
    let maker_side = if params.side == Side::Long { Side::Short } else { Side::Long };
    for i in 0..fill_count {
        let info = &ctx.remaining_accounts[i];
        update_maker_position(
            info,
            fills[i].maker,
            market_key,
            maker_side,
            fills[i].price,
            fills[i].size,
            cfr,
            init_margin_ratio,
        )?;

        emit!(OrderFilled {
            market: market_key,
            maker: fills[i].maker,
            taker: taker_key,
            side: params.side,
            price: fills[i].price,
            size: fills[i].size,
            maker_sequence_number: fills[i].maker_seq,
        });
    }

    // ── emit OrderPlaced ──────────────────────────────────────────────────────
    emit!(OrderPlaced {
        market: market_key,
        trader: taker_key,
        side: params.side,
        order_type: params.order_type,
        price: params.price,
        size: params.size,
        filled_size,
        sequence_number: resting_seq,
    });

    Ok(())
}

// ── Matching engine helpers ────────────────────────────────────────────────

/// Checks whether a taker order would immediately cross the spread.
fn check_would_cross(market: &Market, params: &PlaceOrderParams) -> bool {
    match params.side {
        Side::Long => {
            // Long taker crosses if there's an ask at or below the order price.
            let n = market.num_asks as usize;
            n > 0 && market.asks[0].is_active() && market.asks[0].price <= params.price
        }
        Side::Short => {
            // Short taker crosses if there's a bid at or above the order price.
            let n = market.num_bids as usize;
            n > 0 && market.bids[0].is_active() && market.bids[0].price >= params.price
        }
    }
}

/// Finds and applies one fill. Returns `(maker, fill_price, fill_size, maker_seq)`.
///
/// * Long taker matches against asks (ascending — asks[0] is best/cheapest ask).
/// * Short taker matches against bids (descending — bids[0] is best/highest bid).
fn match_one(
    market: &mut Market,
    params: &PlaceOrderParams,
    remaining: u64,
    taker: Pubkey,
) -> Result<Option<(Pubkey, u64, u64, u64)>> {
    let is_market = params.order_type == OrderType::Market;

    match params.side {
        Side::Long => {
            // Match against asks.
            let n = market.num_asks as usize;
            if n == 0 {
                return Ok(None);
            }
            let ask = &market.asks[0];
            if !ask.is_active() {
                return Ok(None);
            }
            if !is_market && ask.price > params.price {
                return Ok(None); // no crossing ask within limit
            }
            // Self-trade prevention.
            if ask.trader == taker {
                return Ok(None);
            }

            let fill_price = ask.price;
            let fill_size = remaining.min(ask.size);
            let maker = ask.trader;
            let seq = ask.sequence_number;

            if fill_size == ask.size {
                remove_from_asks(market, 0);
            } else {
                market.asks[0].size -= fill_size;
            }
            Ok(Some((maker, fill_price, fill_size, seq)))
        }
        Side::Short => {
            // Match against bids.
            let n = market.num_bids as usize;
            if n == 0 {
                return Ok(None);
            }
            let bid = &market.bids[0];
            if !bid.is_active() {
                return Ok(None);
            }
            if !is_market && bid.price < params.price {
                return Ok(None); // no crossing bid within limit
            }
            // Self-trade prevention.
            if bid.trader == taker {
                return Ok(None);
            }

            let fill_price = bid.price;
            let fill_size = remaining.min(bid.size);
            let maker = bid.trader;
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

/// Insert a resting bid. Bids are kept descending by price; ascending by
/// sequence_number as a tiebreaker (lower seq = earlier = higher priority).
fn insert_bid(market: &mut Market, order: Order) -> Result<()> {
    require!(
        (market.num_bids as usize) < MAX_ORDERS,
        ProtoperpsError::OrderBookFull
    );
    let n = market.num_bids as usize;
    // Find insertion point.
    let pos = (0..n)
        .find(|&i| {
            market.bids[i].price < order.price
                || (market.bids[i].price == order.price
                    && market.bids[i].sequence_number > order.sequence_number)
        })
        .unwrap_or(n);
    // Shift right to make room.
    let mut i = n;
    while i > pos {
        market.bids[i] = market.bids[i - 1];
        i -= 1;
    }
    market.bids[pos] = order;
    market.num_bids += 1;
    Ok(())
}

/// Insert a resting ask. Asks are kept ascending by price; ascending by
/// sequence_number as a tiebreaker.
fn insert_ask(market: &mut Market, order: Order) -> Result<()> {
    require!(
        (market.num_asks as usize) < MAX_ORDERS,
        ProtoperpsError::OrderBookFull
    );
    let n = market.num_asks as usize;
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
    let n = market.num_bids as usize;
    for i in idx..n.saturating_sub(1) {
        market.bids[i] = market.bids[i + 1];
    }
    market.num_bids = market.num_bids.saturating_sub(1);
}

fn remove_from_asks(market: &mut Market, idx: usize) {
    let n = market.num_asks as usize;
    for i in idx..n.saturating_sub(1) {
        market.asks[i] = market.asks[i + 1];
    }
    market.num_asks = market.num_asks.saturating_sub(1);
}

// ── Position math ──────────────────────────────────────────────────────────

/// Update a Position account for a fill on the given `order_side`.
///
/// Handles three cases:
///   1. New position (size == 0): open.
///   2. Same side: increase size with VWAP entry price.
///   3. Opposite side: reduce or flip (realise PnL for closed portion).
fn update_position(
    pos: &mut Position,
    order_side: Side,
    fill_price: u64,
    fill_size: u64,
) -> Result<()> {
    if pos.size == 0 {
        // Open new position.
        pos.side = order_side;
        pos.entry_price = fill_price;
        pos.size = fill_size;
    } else if pos.side == order_side {
        // Increase position — VWAP entry price.
        let new_size = (pos.size as u128)
            .checked_add(fill_size as u128)
            .ok_or(ProtoperpsError::MathOverflow)?;
        let vwap = ((pos.size as u128)
            .checked_mul(pos.entry_price as u128)
            .ok_or(ProtoperpsError::MathOverflow)?
            .checked_add(
                (fill_size as u128)
                    .checked_mul(fill_price as u128)
                    .ok_or(ProtoperpsError::MathOverflow)?,
            )
            .ok_or(ProtoperpsError::MathOverflow)?)
        .checked_div(new_size)
        .ok_or(ProtoperpsError::DivisionByZero)?;

        pos.size = new_size as u64;
        pos.entry_price = vwap as u64;
    } else {
        // Reduce or flip position.
        if fill_size < pos.size {
            // Partial close.
            let pnl = realised_pnl(pos.side, pos.entry_price, fill_price, fill_size)?;
            pos.realized_pnl = pos
                .realized_pnl
                .checked_add(pnl)
                .ok_or(ProtoperpsError::MathOverflow)?;
            pos.size -= fill_size;
        } else if fill_size == pos.size {
            // Full close.
            let pnl = realised_pnl(pos.side, pos.entry_price, fill_price, fill_size)?;
            pos.realized_pnl = pos
                .realized_pnl
                .checked_add(pnl)
                .ok_or(ProtoperpsError::MathOverflow)?;
            pos.size = 0;
            pos.entry_price = 0;
        } else {
            // Flip: close all + open new position in opposite direction.
            let close_size = pos.size;
            let new_open = fill_size - close_size;
            let pnl = realised_pnl(pos.side, pos.entry_price, fill_price, close_size)?;
            pos.realized_pnl = pos
                .realized_pnl
                .checked_add(pnl)
                .ok_or(ProtoperpsError::MathOverflow)?;
            pos.side = order_side;
            pos.entry_price = fill_price;
            pos.size = new_open;
        }
    }
    Ok(())
}

/// Realised PnL in USDC_PRECISION for closing `close_size` of a position.
///
///  Long: pnl = (close_price - entry_price) * close_size / LOT_PRECISION
///  Short: pnl = (entry_price - close_price) * close_size / LOT_PRECISION
fn realised_pnl(side: Side, entry: u64, close: u64, size: u64) -> Result<i64> {
    let diff: i64 = if side == Side::Long {
        (close as i64)
            .checked_sub(entry as i64)
            .ok_or(ProtoperpsError::MathOverflow)?
    } else {
        (entry as i64)
            .checked_sub(close as i64)
            .ok_or(ProtoperpsError::MathOverflow)?
    };
    let pnl = (diff as i128)
        .checked_mul(size as i128)
        .ok_or(ProtoperpsError::MathOverflow)?
        .checked_div(LOT_PRECISION as i128)
        .ok_or(ProtoperpsError::DivisionByZero)?;
    Ok(pnl as i64)
}

/// Load a maker's Position from remaining_accounts, update it, and write back.
fn update_maker_position(
    info: &AccountInfo,
    expected_trader: Pubkey,
    market_key: Pubkey,
    order_side: Side,
    fill_price: u64,
    fill_size: u64,
    cfr: i64,
    init_margin_ratio: u64,
) -> Result<()> {
    // Must be owned by this program.
    require_keys_eq!(*info.owner, crate::ID, ProtoperpsError::MakerPositionMismatch);
    require!(info.is_writable, ProtoperpsError::MakerPositionMismatch);

    let mut data = info.try_borrow_mut_data()?;
    // Deserialize (reads and verifies the 8-byte discriminator).
    let mut slice: &[u8] = &data;
    let mut pos = Position::try_deserialize(&mut slice)?;

    // Sanity checks.
    require_keys_eq!(pos.trader, expected_trader, ProtoperpsError::MakerPositionMismatch);
    require_keys_eq!(pos.market, market_key, ProtoperpsError::MakerPositionMismatch);

    // If first fill for this position, initialise funding snapshot.
    if pos.size == 0 && pos.last_funding_rate == 0 {
        pos.last_funding_rate = cfr;
    }

    update_position(&mut pos, order_side, fill_price, fill_size)?;

    // Accumulate position collateral for the filled portion.
    let fill_margin = compute_margin(fill_price, fill_size, init_margin_ratio)?;
    pos.collateral = pos
        .collateral
        .checked_add(fill_margin)
        .ok_or(ProtoperpsError::MathOverflow)?;

    // Write back (discriminator + data).
    let mut cursor = std::io::Cursor::new(&mut data[..]);
    pos.try_serialize(&mut cursor)?;

    Ok(())
}

// ── Margin math ────────────────────────────────────────────────────────────

/// Required initial margin in USDC_PRECISION for a given notional exposure.
///
/// margin = price * size / LOT_PRECISION * margin_ratio / BPS_PRECISION
fn compute_margin(price: u64, size: u64, margin_ratio: u64) -> Result<u64> {
    // notional in USDC_PRECISION = price * size / LOT_PRECISION
    let notional = (price as u128)
        .checked_mul(size as u128)
        .ok_or(ProtoperpsError::MathOverflow)?
        .checked_div(LOT_PRECISION as u128)
        .ok_or(ProtoperpsError::DivisionByZero)?;

    let margin = notional
        .checked_mul(margin_ratio as u128)
        .ok_or(ProtoperpsError::MathOverflow)?
        .checked_div(BPS_PRECISION as u128)
        .ok_or(ProtoperpsError::DivisionByZero)?;

    Ok(margin as u64)
}

/// Notional in USDC_PRECISION = price * size / LOT_PRECISION.
fn notional_usdc(price: u64, size: u64) -> Result<u64> {
    let n = (price as u128)
        .checked_mul(size as u128)
        .ok_or(ProtoperpsError::MathOverflow)?
        .checked_div(LOT_PRECISION as u128)
        .ok_or(ProtoperpsError::DivisionByZero)?;
    Ok(n as u64)
}

/// Average fill price across all filled records.
fn average_fill_price(fills: &[FillRecord; 5], count: usize) -> Result<u64> {
    if count == 0 {
        return Ok(0);
    }
    let mut total_notional: u128 = 0;
    let mut total_size: u128 = 0;
    for i in 0..count {
        total_notional = total_notional
            .checked_add((fills[i].price as u128) * (fills[i].size as u128))
            .ok_or(ProtoperpsError::MathOverflow)?;
        total_size = total_size
            .checked_add(fills[i].size as u128)
            .ok_or(ProtoperpsError::MathOverflow)?;
    }
    let avg = total_notional
        .checked_div(total_size)
        .ok_or(ProtoperpsError::DivisionByZero)?;
    Ok(avg as u64)
}
