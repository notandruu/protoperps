pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod oracle_client;
pub mod state;

pub use errors::*;
pub use events::*;
pub use math::*;
pub use state::*;

// Re-export accounts structs and instruction modules.
pub use instructions::{
    CancelOrder, CancelOrderParams, DepositCollateral, InitializeMarket, InitializeMarketParams,
    Liquidate, PlaceOrder, PlaceOrderParams, SettleFunding, UpdateFunding, UpdateFundingParams,
    UpdateMarketParams, UpdateMarketParamsArgs, WithdrawCollateral,
};
pub use instructions::cancel_order;
pub use instructions::deposit_collateral;
pub use instructions::initialize_market;
pub use instructions::liquidate;
pub use instructions::place_order;
pub use instructions::settle_funding;
pub use instructions::update_funding;
pub use instructions::update_market_params;
pub use instructions::withdraw_collateral;

// Re-export __client_accounts_* modules at crate root with crate visibility.
// The #[program] macro generates `pub use crate::__client_accounts_<name>::*`
// inside its generated `pub mod accounts` block.
pub(crate) use cancel_order::__client_accounts_cancel_order;
pub(crate) use deposit_collateral::__client_accounts_deposit_collateral;
pub(crate) use initialize_market::__client_accounts_initialize_market;
pub(crate) use liquidate::__client_accounts_liquidate;
pub(crate) use place_order::__client_accounts_place_order;
pub(crate) use settle_funding::__client_accounts_settle_funding;
pub(crate) use update_funding::__client_accounts_update_funding;
pub(crate) use update_market_params::__client_accounts_update_market_params;
pub(crate) use withdraw_collateral::__client_accounts_withdraw_collateral;

use anchor_lang::prelude::*;

declare_id!("J65U84LyKvCtv76ynd4MBCfjQqTXLjHvFbpieVqRUjbW");

#[program]
pub mod protoperps {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitializeMarketParams,
    ) -> Result<()> {
        initialize_market::initialize_market(ctx, params)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        deposit_collateral::deposit_collateral(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        withdraw_collateral::withdraw_collateral(ctx, amount)
    }

    pub fn place_order(ctx: Context<PlaceOrder>, params: PlaceOrderParams) -> Result<()> {
        place_order::place_order(ctx, params)
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, params: CancelOrderParams) -> Result<()> {
        cancel_order::cancel_order(ctx, params)
    }

    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        liquidate::liquidate(ctx)
    }

    pub fn update_funding(ctx: Context<UpdateFunding>, params: UpdateFundingParams) -> Result<()> {
        update_funding::update_funding(ctx, params)
    }

    pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
        settle_funding::settle_funding(ctx)
    }

    pub fn update_market_params(
        ctx: Context<UpdateMarketParams>,
        args: UpdateMarketParamsArgs,
    ) -> Result<()> {
        update_market_params::update_market_params(ctx, args)
    }
}
