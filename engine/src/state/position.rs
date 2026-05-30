use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::enums::Side;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: Uuid,
    pub market: String,
    pub trader: String,
    pub side: Side,
    pub size: u64,
    pub entry_price: u64,
    pub collateral: u64,
    pub last_funding_rate: i64,
    pub realized_pnl: i64,
}

impl Position {
    pub fn new(market: &str, trader: &str, side: Side, cfr: i64) -> Self {
        Position {
            id: Uuid::new_v4(),
            market: market.to_string(),
            trader: trader.to_string(),
            side,
            size: 0,
            entry_price: 0,
            collateral: 0,
            last_funding_rate: cfr,
            realized_pnl: 0,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.size == 0
    }
}
