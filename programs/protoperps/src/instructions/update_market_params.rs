use anchor_lang::prelude::*;

use crate::errors::ProtoperpsError;
use crate::math::BPS_PRECISION;
use crate::state::market::Market;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateMarketParamsArgs {
    pub max_leverage: u64,
    pub initial_margin_ratio: u64,
    pub maintenance_margin_ratio: u64,
}

#[derive(Accounts)]
pub struct UpdateMarketParams<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
}

pub fn update_market_params(
    ctx: Context<UpdateMarketParams>,
    args: UpdateMarketParamsArgs,
) -> Result<()> {
    {
        let market = ctx.accounts.market.load()?;
        require_keys_eq!(
            market.authority,
            ctx.accounts.authority.key(),
            ProtoperpsError::Unauthorized
        );
    }

    require!(
        args.max_leverage >= 1 && args.max_leverage <= 100,
        ProtoperpsError::InvalidLeverage
    );
    require!(
        args.initial_margin_ratio > 0 && args.initial_margin_ratio <= BPS_PRECISION,
        ProtoperpsError::InvalidMarginRatio
    );
    require!(
        args.maintenance_margin_ratio > 0
            && args.maintenance_margin_ratio < args.initial_margin_ratio,
        ProtoperpsError::MarginRatioConflict
    );

    let mut market = ctx.accounts.market.load_mut()?;
    market.max_leverage = args.max_leverage;
    market.initial_margin_ratio = args.initial_margin_ratio;
    market.maintenance_margin_ratio = args.maintenance_margin_ratio;

    Ok(())
}
