use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::events::PositionLiquidated;
use crate::math::{calculate_margin_ratio, calculate_unrealized_pnl, BPS_PRECISION, LOT_PRECISION};
use crate::state::enums::MarketStatus;
use crate::state::margin::MarginAccount;
use crate::state::market::Market;
use crate::state::position::Position;

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// Anyone may call liquidate; there is no permissioning on the caller.
    #[account(mut)]
    pub liquidator: Signer<'info>,

    /// The perpetual market the position belongs to.
    pub market: AccountLoader<'info, Market>,

    /// The under-margined position to close.
    ///
    /// Validated: position.market == market.key() and
    ///            position.trader == trader_margin.owner.
    #[account(
        mut,
        constraint = position.market == market.key() @ ProtoperpsError::MakerPositionMismatch,
        constraint = position.trader == trader_margin.owner @ ProtoperpsError::TraderMarginMismatch,
    )]
    pub position: Account<'info, Position>,

    /// The trader's margin account.  Losses are deducted from usdc_deposited;
    /// locked margin for the position is released from usdc_locked.
    #[account(
        mut,
        seeds = [b"margin", trader_margin.owner.as_ref()],
        bump = trader_margin.bump,
    )]
    pub trader_margin: Account<'info, MarginAccount>,

    /// The liquidator's margin account — reward is credited here.
    /// Must be pre-created (liquidator must have deposited at least once).
    #[account(
        mut,
        seeds = [b"margin", liquidator.key().as_ref()],
        bump = liquidator_margin.bump,
    )]
    pub liquidator_margin: Account<'info, MarginAccount>,

    /// CHECK: Validated by `load_oracle` — owner == ORACLE_PROGRAM_ID and size ≥ mirror.
    /// Liquidation is allowed when oracle is Active or ReduceOnly; rejected only when Paused.
    pub oracle_feed: UncheckedAccount<'info>,
}

pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market_key = ctx.accounts.market.key();

    // ── Load and validate oracle ──────────────────────────────────────────────
    let oracle = crate::oracle_client::load_oracle(ctx.accounts.oracle_feed.as_ref())?;
    require_keys_eq!(
        Pubkey::from(oracle.market),
        market_key,
        ProtoperpsError::InvalidOracle
    );
    let oracle_status = crate::oracle_client::effective_status(&oracle, now);
    // Allow liquidation in Active and ReduceOnly states; reject only on Paused.
    require!(
        oracle_status != crate::oracle_client::EffectiveOracleStatus::Paused,
        ProtoperpsError::OraclePaused
    );
    let mark_price = oracle.price;
    require!(mark_price > 0, ProtoperpsError::PriceZero);

    let pos = &ctx.accounts.position;
    let trader_key = pos.trader;

    // ── Reject if position is already closed ─────────────────────────────────
    require!(!pos.is_closed(), ProtoperpsError::PositionNotOpen);

    // ── Load market params (read-only) ────────────────────────────────────────
    let (maint_margin_ratio, liq_reward_bps) = {
        let market = ctx.accounts.market.load()?;
        // Market-level status guard (belt-and-suspenders with oracle check above).
        require!(
            market.status() != MarketStatus::Paused,
            ProtoperpsError::MarketNotActive
        );
        (
            market.maintenance_margin_ratio,
            market.liquidation_reward_bps,
        )
    };

    // Snapshot position fields before mutable borrow.
    let entry_price = pos.entry_price;
    let size = pos.size;
    let side = pos.side;
    let prior_realized_pnl = pos.realized_pnl;
    let position_collateral = pos.collateral;

    // ── Verify liquidation condition ──────────────────────────────────────────
    let upnl = calculate_unrealized_pnl(entry_price, mark_price, size, side, LOT_PRECISION)?;

    let mark_notional = (mark_price as u128)
        .checked_mul(size as u128)
        .ok_or(error!(ProtoperpsError::MathOverflow))?
        .checked_div(LOT_PRECISION as u128)
        .ok_or(error!(ProtoperpsError::DivisionByZero))? as u64;

    let margin_ratio = calculate_margin_ratio(position_collateral, upnl, mark_notional)?;

    require!(
        margin_ratio < maint_margin_ratio,
        ProtoperpsError::NotLiquidatable
    );

    // ── Compute remaining equity after PnL ────────────────────────────────────
    let equity: i128 = (position_collateral as i128)
        .checked_add(upnl as i128)
        .ok_or(error!(ProtoperpsError::MathOverflow))?;

    // ── Close the position ────────────────────────────────────────────────────
    {
        let pos = &mut ctx.accounts.position;
        pos.realized_pnl = prior_realized_pnl
            .checked_add(upnl)
            .ok_or(error!(ProtoperpsError::MathOverflow))?;
        pos.size = 0;
        pos.entry_price = 0;
        pos.collateral = 0;
    }

    // ── Settle margin accounts ────────────────────────────────────────────────
    //
    // 1. Release the locked initial margin.
    // 2. Deduct the realized loss from the trader's deposited balance.
    // 3. Pay the liquidation reward to the liquidator (only when equity > 0).

    let trader_margin = &mut ctx.accounts.trader_margin;

    // Release locked margin.
    trader_margin.usdc_locked = trader_margin
        .usdc_locked
        .saturating_sub(position_collateral);

    // Apply PnL to deposited balance.
    if upnl < 0 {
        let loss = (-upnl) as u64;
        trader_margin.usdc_deposited = trader_margin.usdc_deposited.saturating_sub(loss);
    } else if upnl > 0 {
        trader_margin.usdc_deposited = trader_margin
            .usdc_deposited
            .checked_add(upnl as u64)
            .ok_or(error!(ProtoperpsError::MathOverflow))?;
    }

    // Liquidator reward — only when the position still has remaining equity.
    let liquidator_reward = if equity > 0 {
        let eq_u64 = equity as u64;
        let reward = (eq_u64 as u128)
            .checked_mul(liq_reward_bps as u128)
            .ok_or(error!(ProtoperpsError::MathOverflow))?
            .checked_div(BPS_PRECISION as u128)
            .ok_or(error!(ProtoperpsError::DivisionByZero))?
            as u64;

        // Deduct reward from the trader's remaining balance.
        trader_margin.usdc_deposited = trader_margin.usdc_deposited.saturating_sub(reward);

        // Credit the liquidator.
        ctx.accounts.liquidator_margin.usdc_deposited = ctx
            .accounts
            .liquidator_margin
            .usdc_deposited
            .checked_add(reward)
            .ok_or(error!(ProtoperpsError::MathOverflow))?;

        reward
    } else {
        0
    };

    // ── Emit ─────────────────────────────────────────────────────────────────
    emit!(PositionLiquidated {
        market: market_key,
        trader: trader_key,
        liquidator: ctx.accounts.liquidator.key(),
        side,
        mark_price,
        size,
        realized_pnl: upnl,
        liquidator_reward,
    });

    Ok(())
}
