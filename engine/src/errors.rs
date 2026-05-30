use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("math overflow")]
    MathOverflow,
    #[error("division by zero")]
    DivisionByZero,
    #[error("order book full")]
    OrderBookFull,
    #[error("market not active")]
    MarketNotActive,
    #[error("oracle not active")]
    OracleNotActive,
    #[error("oracle paused")]
    OraclePaused,
    #[error("insufficient margin")]
    InsufficientMargin,
    #[error("size is zero")]
    SizeZero,
    #[error("price is zero")]
    PriceZero,
    #[error("market order no fill")]
    MarketOrderNoFill,
    #[error("post-only would cross")]
    PostOnlyWouldCross,
    #[error("position not open")]
    PositionNotOpen,
    #[error("not liquidatable")]
    NotLiquidatable,
    #[error("unknown market: {0}")]
    UnknownMarket(String),
    #[error("unknown trader: {0}")]
    UnknownTrader(String),
}
