pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("Bk1ao9hgiYxubch1XtrtaWTsYFscMqbH5QnahB6WLMZV");

// Anchor 1.0.0: the generated __client_accounts_* types must be visible
// at the crate root for cross-program CPI consumers.
pub(crate) use admin_pause::__client_accounts_admin_pause;
pub(crate) use initialize_feed::__client_accounts_initialize_feed;
pub(crate) use update_price::__client_accounts_update_price;

#[program]
pub mod oracle {
    use super::*;

    /// Create an OraclePrice PDA for a given protoperps market.
    /// Callable once per market by the keeper that will own the feed.
    pub fn initialize_feed(
        ctx: Context<InitializeFeed>,
        params: InitializeFeedParams,
    ) -> Result<()> {
        instructions::initialize_feed(ctx, params)
    }

    /// Push a new price to the feed.
    /// Rejects if: caller ≠ authority, price = 0, or |Δprice| > 10%.
    /// Always sets status = Active on success (feed is freshly updated).
    pub fn update_price(
        ctx: Context<UpdatePrice>,
        params: UpdatePriceParams,
    ) -> Result<()> {
        instructions::update_price(ctx, params)
    }

    /// Manually pause a feed. Only the authority may call this.
    /// To resume, the authority simply calls update_price (which resets status to Active).
    pub fn admin_pause(ctx: Context<AdminPause>) -> Result<()> {
        instructions::admin_pause(ctx)
    }
}
