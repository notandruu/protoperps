use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::events::FundingSettled;
use crate::math::FUNDING_PRECISION;
use crate::state::enums::Side;
use crate::state::margin::MarginAccount;
use crate::state::market::Market;
use crate::state::position::Position;

#[derive(Accounts)]
pub struct SettleFunding<'info> {
    /// The trader settling their own funding accrual.  Must own the position.
    pub trader: Signer<'info>,

    /// The market this position belongs to (read-only).
    pub market: AccountLoader<'info, Market>,

    /// Position being settled.
    #[account(
        mut,
        constraint = position.market == market.key()  @ ProtoperpsError::MakerPositionMismatch,
        constraint = position.trader == trader.key()  @ ProtoperpsError::TraderMarginMismatch,
    )]
    pub position: Account<'info, Position>,

    /// Trader's margin account — USDC balance is adjusted for funding.
    #[account(
        mut,
        seeds = [b"margin", trader.key().as_ref()],
        bump = trader_margin.bump,
    )]
    pub trader_margin: Account<'info, MarginAccount>,
}

pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
    let market_key = ctx.accounts.market.key();
    let cfr = {
        let market = ctx.accounts.market.load()?;
        market.cumulative_funding_rate
    };

    let pos = &ctx.accounts.position;
    let size = pos.size;
    let pos_side = pos.side;
    let last_rate = pos.last_funding_rate;

    // Nothing to do for closed positions.
    if size == 0 {
        return Ok(());
    }

    let delta_rate = cfr
        .checked_sub(last_rate)
        .ok_or(ProtoperpsError::MathOverflow)?;

    if delta_rate == 0 {
        return Ok(());
    }

    // funding_delta = delta_rate * size / FUNDING_PRECISION   (in USDC_PRECISION units)
    //
    // Positive cumulative delta → longs pay shorts; negative → shorts pay longs.
    let raw_delta = (delta_rate as i128)
        .checked_mul(size as i128)
        .ok_or(ProtoperpsError::MathOverflow)?
        .checked_div(FUNDING_PRECISION as i128)
        .ok_or(ProtoperpsError::DivisionByZero)?;

    // Signed from the trader's perspective:
    //   Long  position: collateral decreases when delta_rate > 0 (paying)
    //   Short position: collateral increases when delta_rate > 0 (receiving)
    let collateral_change: i128 = if pos_side == Side::Long {
        -raw_delta
    } else {
        raw_delta
    };

    // ── Apply to position collateral ──────────────────────────────────────────
    {
        let pos = &mut ctx.accounts.position;
        pos.last_funding_rate = cfr;
        if collateral_change < 0 {
            let loss = (-collateral_change) as u64;
            pos.collateral = pos.collateral.saturating_sub(loss);
        } else {
            pos.collateral = pos
                .collateral
                .checked_add(collateral_change as u64)
                .ok_or(ProtoperpsError::MathOverflow)?;
        }
    }

    // ── Apply to margin account deposited balance ─────────────────────────────
    {
        let margin = &mut ctx.accounts.trader_margin;
        if collateral_change < 0 {
            let loss = (-collateral_change) as u64;
            margin.usdc_deposited = margin.usdc_deposited.saturating_sub(loss);
        } else {
            margin.usdc_deposited = margin
                .usdc_deposited
                .checked_add(collateral_change as u64)
                .ok_or(ProtoperpsError::MathOverflow)?;
        }
    }

    emit!(FundingSettled {
        market: market_key,
        trader: ctx.accounts.trader.key(),
        funding_delta: collateral_change as i64,
        new_cumulative_funding_rate: cfr,
    });

    Ok(())
}
