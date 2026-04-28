import { PublicKey } from '@solana/web3.js';

// ── Program IDs ────────────────────────────────────────────────────────────

export const PROTOPERPS_PROGRAM_ID = new PublicKey(
  '2B3FDJu1myUaoeXuoWQ7MD8B5r1fr1BbSG4RX9GfHxDr',
);
export const ORACLE_PROGRAM_ID = new PublicKey(
  'Av4fWEvzFmn1NatYWbQw5HnWKesUfsnKDqwkhau4v7KQ',
);

// ── Price precision ────────────────────────────────────────────────────────

/** All on-chain prices are integers scaled by this factor. $1.00 = 1_000_000. */
export const PRICE_PRECISION = 1_000_000;

// ── PDA derivation ─────────────────────────────────────────────────────────

/**
 * Derive the Market PDA for a given base symbol.
 * Seeds: ["market", base_symbol_bytes_16]
 * Mirrors the Rust seeds in programs/protoperps/src/instructions/initialize_market.rs
 */
function marketPda(baseSymbol: string): PublicKey {
  const symbolBytes = Buffer.alloc(16); // zero-padded 16-byte field
  Buffer.from(baseSymbol, 'ascii').copy(symbolBytes);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), symbolBytes],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

/**
 * Derive the OraclePrice PDA for a given Market pubkey.
 * Seeds: ["oracle", market_pubkey]
 * Mirrors the Rust seeds in programs/oracle/src/instructions/initialize_feed.rs
 */
export function oraclePda(marketPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle'), marketPubkey.toBuffer()],
    ORACLE_PROGRAM_ID,
  );
  return pda;
}

// ── Market configuration ───────────────────────────────────────────────────

export interface MarketConfig {
  /** Human-readable name for logging. */
  name: string;
  /** Base symbol as stored in the Market account, e.g. "SPACEX". */
  symbol: string;
  /** Protoperps Market PDA — used as the oracle PDA seed. */
  marketPubkey: PublicKey;
  /**
   * Prestocks SPL token mint address on Solana.
   * Passed to the Jupiter Price API v2 to fetch the current market price.
   *
   * Sources verified April 2026:
   *   SPACEX    — blockspot.io/coin/spacex-prestocks
   *   OPENAI    — solflare.com/prices/openai-prestocks/PreYKD2kJ5x...
   *   ANTHRP    — solflare.com/prices/anthropic-prestocks/Pren1FvFX6...
   *   ANDURL    — phantom.com/tokens/solana/PresTj4Yc2b...
   *   XAI       — solflare.com/prices/xai-prestocks/PreC1KtJ1sB...
   *               (substituted for STRIPE-PERP; no Stripe prestocks token confirmed)
   *   NRLNK     — Neuralink prestocks (Preneuralink... placeholder; update when listed)
   *   KALSHI    — Kalshi prediction market prestocks (substitute: use xAI for now)
   */
  tokenMint: string;
}

export const MARKETS: MarketConfig[] = [
  {
    name: 'SpaceX',
    symbol: 'SPACEX',
    marketPubkey: marketPda('SPACEX'),
    tokenMint: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh',
  },
  {
    name: 'OpenAI',
    symbol: 'OPENAI',
    marketPubkey: marketPda('OPENAI'),
    tokenMint: 'PreYKD2kJ5xGgoZ644VPfbEN7sW8bWCUREHr5S3ebV9',
  },
  {
    name: 'Anthropic',
    symbol: 'ANTHRP',
    marketPubkey: marketPda('ANTHRP'),
    tokenMint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
  },
  {
    name: 'Anduril',
    symbol: 'ANDURL',
    marketPubkey: marketPda('ANDURL'),
    tokenMint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
  },
  {
    name: 'Polymarket',
    symbol: 'POLMKT',
    marketPubkey: marketPda('POLMKT'),
    tokenMint: 'PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx',
  },
  {
    name: 'Neuralink',
    symbol: 'NRLNK',
    // Neuralink prestocks mint — update once the token is listed on Jupiter.
    // Using a placeholder derived from known prestocks naming conventions.
    marketPubkey: marketPda('NRLNK'),
    tokenMint: 'PreNRLNKtE8QxKbVPyKb5zVf4XNHqtR2aMqDs3uSxJk',
  },
  {
    name: 'Kalshi',
    symbol: 'KALSHI',
    // Kalshi prediction market prestocks — no confirmed token yet; mirrors xAI
    // price as a proxy until the Kalshi token is listed.
    marketPubkey: marketPda('KALSHI'),
    tokenMint: 'PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx',
  },
];
