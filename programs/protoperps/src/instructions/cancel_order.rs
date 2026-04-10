use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::events::OrderCancelled;
use crate::math::{BPS_PRECISION, LOT_PRECISION};
use crate::state::enums::Side;
use crate::state::margin::MarginAccount;
use crate::state::market::Market;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CancelOrderParams {
    /// Side of the order to cancel.
    pub side: Side,
    /// Sequence number of the order (returned in OrderPlaced event).
    pub sequence_number: u64,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    /// The market containing the order book.
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,

    /// Trader's margin account — margin is unlocked on cancel.
    #[account(
        mut,
        seeds = [b"margin", trader.key().as_ref()],
        bump = trader_margin.bump,
    )]
    pub trader_margin: Account<'info, MarginAccount>,
}

pub fn cancel_order(ctx: Context<CancelOrder>, params: CancelOrderParams) -> Result<()> {
    let trader_key = ctx.accounts.trader.key();
    let market_key = ctx.accounts.market.key();

    // ── find and remove the order; capture margin params while borrowed ──────
    let (cancelled_price, cancelled_size, init_margin_ratio) = {
        let mut market = ctx.accounts.market.load_mut()?;
        let init_margin_ratio = market.initial_margin_ratio;

        let (price, size) = match params.side {
            Side::Long => {
                let n = market.num_bids as usize;
                let idx = (0..n)
                    .find(|&i| {
                        market.bids[i].is_active()
                            && market.bids[i].sequence_number == params.sequence_number
                    })
                    .ok_or(ProtoperpsError::OrderNotFound)?;

                require_keys_eq!(
                    market.bids[idx].trader,
                    trader_key,
                    ProtoperpsError::OrderOwnerMismatch
                );

                let price = market.bids[idx].price;
                let size = market.bids[idx].size;

                // Shift remaining bids left.
                for i in idx..n.saturating_sub(1) {
                    market.bids[i] = market.bids[i + 1];
                }
                market.num_bids = market.num_bids.saturating_sub(1);

                (price, size)
            }
            Side::Short => {
                let n = market.num_asks as usize;
                let idx = (0..n)
                    .find(|&i| {
                        market.asks[i].is_active()
                            && market.asks[i].sequence_number == params.sequence_number
                    })
                    .ok_or(ProtoperpsError::OrderNotFound)?;

                require_keys_eq!(
                    market.asks[idx].trader,
                    trader_key,
                    ProtoperpsError::OrderOwnerMismatch
                );

                let price = market.asks[idx].price;
                let size = market.asks[idx].size;

                for i in idx..n.saturating_sub(1) {
                    market.asks[i] = market.asks[i + 1];
                }
                market.num_asks = market.num_asks.saturating_sub(1);

                (price, size)
            }
        };

        (price, size, init_margin_ratio)
    };
    // market borrow released.

    // ── unlock margin ────────────────────────────────────────────────────────
    let locked_margin = margin_for(cancelled_price, cancelled_size, init_margin_ratio)?;
    let trader_margin = &mut ctx.accounts.trader_margin;
    trader_margin.usdc_locked = trader_margin.usdc_locked.saturating_sub(locked_margin);

    // ── emit ─────────────────────────────────────────────────────────────────
    emit!(OrderCancelled {
        market: market_key,
        trader: trader_key,
        side: params.side,
        price: cancelled_price,
        size: cancelled_size,
        sequence_number: params.sequence_number,
    });

    Ok(())
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Initial margin required for a given order.
///
/// margin = price * size / LOT_PRECISION * margin_ratio / BPS_PRECISION
fn margin_for(price: u64, size: u64, margin_ratio: u64) -> Result<u64> {
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
