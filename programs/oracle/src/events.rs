use anchor_lang::prelude::*;

#[event]
pub struct FeedInitialized {
    pub oracle: Pubkey,
    pub market: Pubkey,
    pub authority: Pubkey,
    pub initial_price: u64,
    /// OracleSource as u8.
    pub source: u8,
}

#[event]
pub struct PriceUpdated {
    pub oracle: Pubkey,
    pub market: Pubkey,
    pub price: u64,
    pub twap: u64,
    pub confidence: u64,
    /// OracleSource as u8.
    pub source: u8,
    /// OracleStatus as u8 — always Active after a successful push.
    pub status: u8,
}

#[event]
pub struct FeedPaused {
    pub oracle: Pubkey,
    pub market: Pubkey,
    pub authority: Pubkey,
}
