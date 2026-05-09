use anchor_lang::prelude::*;

#[error_code]
pub enum ProtoperpsError {
    // ── math ──────────────────────────────────────────────────────────────────
    #[msg("math overflow")]
    MathOverflow,

    // ── initialize_market ─────────────────────────────────────────────────────
    #[msg("tick size must be greater than zero")]
    InvalidTickSize,
    #[msg("lot size must be greater than zero")]
    InvalidLotSize,
    #[msg("max leverage must be between 1 and 100")]
    InvalidLeverage,
    #[msg("signer is not the market authority")]
    Unauthorized,
    #[msg("margin ratio must be greater than zero and at most 100%")]
    InvalidMarginRatio,
    #[msg("initial margin ratio must exceed maintenance margin ratio")]
    MarginRatioConflict,
    #[msg("liquidation reward bps must be greater than zero")]
    InvalidLiquidationReward,
    #[msg("funding interval must be greater than zero")]
    InvalidFundingInterval,

    // ── collateral ────────────────────────────────────────────────────────────
    #[msg("amount must be greater than zero")]
    AmountZero,
    #[msg("insufficient free collateral for withdrawal")]
    InsufficientFreeCollateral,

    // ── place_order ───────────────────────────────────────────────────────────
    #[msg("market is not active")]
    MarketNotActive,
    #[msg("order size must be greater than zero")]
    SizeZero,
    #[msg("limit order price must be greater than zero")]
    PriceZero,
    #[msg("insufficient free collateral for initial margin")]
    InsufficientMargin,
    #[msg("order book is full")]
    OrderBookFull,
    #[msg("market order could not be filled: no liquidity")]
    MarketOrderNoFill,
    #[msg("post-only order would cross the spread")]
    PostOnlyWouldCross,
    #[msg("maker position account does not match expected PDA")]
    MakerPositionMismatch,
    #[msg("division by zero")]
    DivisionByZero,
    #[msg("margin account owner does not match signer")]
    MarginAccountOwnerMismatch,

    // ── cancel_order ──────────────────────────────────────────────────────────
    #[msg("order not found in book for this sequence number and side")]
    OrderNotFound,
    #[msg("order does not belong to signer")]
    OrderOwnerMismatch,

    // ── liquidate ─────────────────────────────────────────────────────────────
    #[msg("position has no open size; nothing to liquidate")]
    PositionNotOpen,
    #[msg("position is above the maintenance margin threshold; not liquidatable")]
    NotLiquidatable,
    #[msg("trader margin account does not match position owner")]
    TraderMarginMismatch,

    // ── oracle ────────────────────────────────────────────────────────────────
    #[msg("oracle is reduce-only or paused; new orders are not accepted")]
    OracleNotActive,
    #[msg("oracle is fully paused; operation is suspended")]
    OraclePaused,
    #[msg("invalid oracle account: wrong program owner or insufficient data size")]
    InvalidOracle,

    // ── funding ───────────────────────────────────────────────────────────────
    #[msg("funding updated too recently; wait for the funding interval to elapse")]
    FundingTooEarly,
}
