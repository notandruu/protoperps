use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginAccount {
    pub trader: String,
    pub usdc_deposited: u64,
    pub usdc_locked: u64,
}

impl MarginAccount {
    pub fn new(trader: &str) -> Self {
        MarginAccount { trader: trader.to_string(), usdc_deposited: 0, usdc_locked: 0 }
    }

    pub fn free_collateral(&self) -> u64 {
        self.usdc_deposited.saturating_sub(self.usdc_locked)
    }
}
