use anchor_lang::prelude::*;

/// Per-trader USDC collateral account.
///
/// Tracks how much USDC the trader has deposited in total and how much
/// is currently locked inside open positions.  The program's USDC vault
/// (a token account owned by this PDA) holds the actual funds.
///
/// free_collateral = usdc_deposited - usdc_locked  (derived, never stored)
///
/// PDA seeds: ["margin", owner]
///
/// Space (including 8-byte Anchor discriminator):
///   8 + MarginAccount::INIT_SPACE  (see MARGIN_ACCOUNT_SPACE below)
#[account]
#[derive(InitSpace)]
pub struct MarginAccount {
    /// PDA bump seed.
    pub bump: u8,
    /// Wallet that owns this margin account.
    pub owner: Pubkey,
    /// Total USDC deposited (USDC_PRECISION units).
    /// Increases on deposit, decreases on withdrawal or realized loss.
    pub usdc_deposited: u64,
    /// USDC currently locked inside open positions (USDC_PRECISION units).
    /// Increases when a position is opened, decreases when it is closed.
    pub usdc_locked: u64,
}

/// Total on-chain bytes for a MarginAccount (discriminator included).
pub const MARGIN_ACCOUNT_SPACE: usize = 8 + MarginAccount::INIT_SPACE;

impl MarginAccount {
    /// USDC available for opening new positions or withdrawal.
    /// Uses saturating subtraction — should never underflow in correct code.
    pub fn free_collateral(&self) -> u64 {
        self.usdc_deposited.saturating_sub(self.usdc_locked)
    }
}
