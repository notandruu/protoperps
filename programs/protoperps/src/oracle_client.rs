/// Minimal read-only client for the oracle program's OraclePrice account.
///
/// The oracle program is a separate Anchor program.  Rather than importing
/// the oracle crate as a dependency (which adds build complexity), we define
/// a bytemuck mirror that matches the oracle program's on-chain layout.
///
/// This module MUST stay in sync with oracle::state::OraclePrice.
/// The layout is verified by the oracle crate's own unit test
/// `struct_size_matches_layout_comment` (128 bytes).

use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

/// ID of the oracle program.  Must match oracle/src/lib.rs declare_id!.
pub const ORACLE_PROGRAM_ID: Pubkey =
    pubkey!("Av4fWEvzFmn1NatYWbQw5HnWKesUfsnKDqwkhau4v7KQ");

// ── Staleness thresholds (mirrors oracle_price.rs constants) ───────────────

/// Oracle goes reduce-only after 5 minutes without an update.
pub const STALE_REDUCE_ONLY_SECS: i64 = 5 * 60;
/// Oracle fully pauses after 15 minutes without an update.
pub const STALE_PAUSE_SECS: i64 = 15 * 60;

// ── Effective oracle status ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EffectiveOracleStatus {
    Active = 0,
    ReduceOnly = 1,
    Paused = 2,
}

// ── OraclePrice mirror ─────────────────────────────────────────────────────
//
// Layout #[repr(C)], 128 bytes — must exactly match oracle::state::OraclePrice.
//
//   offset  field                 type
//        0  bump                  u8
//        1  source                u8
//        2  status                u8
//        3  _pad0                 [u8;5]
//        8  authority             [u8;32]
//       40  market                [u8;32]
//       72  price                 u64
//       80  confidence            u64
//       88  twap                  u64
//       96  previous_price        u64
//      104  twap_samples          u64
//      112  last_update_slot      u64
//      120  last_update_timestamp i64
//      128  (end)

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct OraclePriceMirror {
    pub bump: u8,
    pub source: u8,
    /// OracleStatus: 0 = Active, 1 = ReduceOnly, 2 = Paused.
    pub status: u8,
    pub _pad0: [u8; 5],
    pub authority: [u8; 32],
    pub market: [u8; 32],
    pub price: u64,
    pub confidence: u64,
    pub twap: u64,
    pub previous_price: u64,
    pub twap_samples: u64,
    pub last_update_slot: u64,
    pub last_update_timestamp: i64,
}

const ORACLE_DISCRIMINATOR_SIZE: usize = 8;
const ORACLE_MIRROR_SIZE: usize = std::mem::size_of::<OraclePriceMirror>();

/// Load and parse an oracle feed account.
///
/// Checks:
///   1. Account owner == ORACLE_PROGRAM_ID
///   2. Account data is large enough to hold discriminator + OraclePriceMirror
///
/// Returns the parsed mirror.  Callers use `effective_status` and `price`
/// from the returned struct to make trading decisions.
pub fn load_oracle(info: &AccountInfo) -> Result<OraclePriceMirror> {
    require_keys_eq!(
        *info.owner,
        ORACLE_PROGRAM_ID,
        crate::errors::ProtoperpsError::InvalidOracle
    );
    let data = info.try_borrow_data()?;
    require!(
        data.len() >= ORACLE_DISCRIMINATOR_SIZE + ORACLE_MIRROR_SIZE,
        crate::errors::ProtoperpsError::InvalidOracle
    );
    let mirror = *bytemuck::from_bytes::<OraclePriceMirror>(
        &data[ORACLE_DISCRIMINATOR_SIZE..ORACLE_DISCRIMINATOR_SIZE + ORACLE_MIRROR_SIZE],
    );
    Ok(mirror)
}

/// Determine the effective oracle status, taking into account both the
/// explicit `status` field (set by `admin_pause` / `update_price`) and
/// the staleness computed from `last_update_timestamp`.
///
/// Result is the WORST of the two — whichever is more restrictive wins.
pub fn effective_status(mirror: &OraclePriceMirror, now: i64) -> EffectiveOracleStatus {
    let age = now.saturating_sub(mirror.last_update_timestamp);

    let staleness = if age >= STALE_PAUSE_SECS {
        EffectiveOracleStatus::Paused
    } else if age >= STALE_REDUCE_ONLY_SECS {
        EffectiveOracleStatus::ReduceOnly
    } else {
        EffectiveOracleStatus::Active
    };

    let explicit = match mirror.status {
        2 => EffectiveOracleStatus::Paused,
        1 => EffectiveOracleStatus::ReduceOnly,
        _ => EffectiveOracleStatus::Active,
    };

    // Return whichever is worse.
    staleness.max(explicit)
}
