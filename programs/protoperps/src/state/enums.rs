use anchor_lang::prelude::*;

/// Which side of the market a position or order is on.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Default)]
pub enum Side {
    #[default]
    Long,
    Short,
}

/// Order execution semantics.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Default)]
pub enum OrderType {
    /// Rest on the book at `price`; match if a crossing order arrives.
    #[default]
    Limit,
    /// Match immediately at the best available price; never rest on the book.
    Market,
    /// Rest only — reject if the order would immediately match (maker-only).
    PostOnly,
}

impl Side {
    pub fn to_u8(self) -> u8 {
        match self {
            Side::Long => 0,
            Side::Short => 1,
        }
    }
}

impl OrderType {
    pub fn to_u8(self) -> u8 {
        match self {
            OrderType::Limit => 0,
            OrderType::Market => 1,
            OrderType::PostOnly => 2,
        }
    }
}

/// Trading state of a market, driven by oracle freshness.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Default)]
pub enum MarketStatus {
    /// Oracle fresh — normal trading.
    #[default]
    Active,
    /// Oracle stale > 5 min — close/reduce positions only; no new openings.
    ReduceOnly,
    /// Oracle stale > 15 min — all trading halted; positions frozen.
    Paused,
}
