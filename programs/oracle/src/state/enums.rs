/// Where the price data originated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OracleSource {
    /// Price read from a prestocks DEX pool (Jupiter/Raydium/Meteora).
    DEXPool = 0,
    /// Price sourced from a secondary market (Forge, Carta, EquityZen).
    SecondaryMarket = 1,
    /// Price anchored to the most recent funding round valuation.
    FundingRound = 2,
}

impl OracleSource {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::SecondaryMarket,
            2 => Self::FundingRound,
            _ => Self::DEXPool,
        }
    }
}

/// Operating state of the oracle feed.
///
/// Transitions: Active → ReduceOnly (stale > 5 min) → Paused (stale > 15 min)
/// An admin can also transition directly to Paused at any time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OracleStatus {
    /// Oracle is live; the perps market accepts new orders.
    Active = 0,
    /// Oracle is stale (5–15 min); existing positions can be closed, no new ones.
    ReduceOnly = 1,
    /// Oracle is stale (>15 min) or manually paused; all trading halted.
    Paused = 2,
}

impl OracleStatus {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::ReduceOnly,
            2 => Self::Paused,
            _ => Self::Active,
        }
    }
}
