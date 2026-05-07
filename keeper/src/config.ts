import { PublicKey } from '@solana/web3.js';

// ── Program IDs ────────────────────────────────────────────────────────────

export const PROTOPERPS_PROGRAM_ID = new PublicKey(
  'J65U84LyKvCtv76ynd4MBCfjQqTXLjHvFbpieVqRUjbW',
);
export const ORACLE_PROGRAM_ID = new PublicKey(
  'Bk1ao9hgiYxubch1XtrtaWTsYFscMqbH5QnahB6WLMZV',
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
   */
  tokenMint: string;
  /** Fallback USD price used on devnet when Jupiter has no data for the mint. */
  fallbackPriceUsd: number;
}

export const MARKETS: MarketConfig[] = [
  {
    name: 'SpaceX',
    symbol: 'SPACEX',
    marketPubkey: marketPda('SPACEX'),
    tokenMint: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh',
    fallbackPriceUsd: 732,
  },
  {
    name: 'OpenAI',
    symbol: 'OPENAI',
    marketPubkey: marketPda('OPENAI'),
    tokenMint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
    fallbackPriceUsd: 1761,
  },
  {
    name: 'Anthropic',
    symbol: 'ANTHRP',
    marketPubkey: marketPda('ANTHRP'),
    tokenMint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    fallbackPriceUsd: 1300,
  },
  {
    name: 'Anduril',
    symbol: 'ANDURL',
    marketPubkey: marketPda('ANDURL'),
    tokenMint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
    fallbackPriceUsd: 166,
  },
  {
    name: 'Polymarket',
    symbol: 'POLMKT',
    marketPubkey: marketPda('POLMKT'),
    tokenMint: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP',
    fallbackPriceUsd: 180,
  },
  {
    name: 'Neuralink',
    symbol: 'NRLNK',
    marketPubkey: marketPda('NRLNK'),
    tokenMint: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S',
    fallbackPriceUsd: 358,
  },
  {
    name: 'Kalshi',
    symbol: 'KALSHI',
    marketPubkey: marketPda('KALSHI'),
    tokenMint: 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua',
    fallbackPriceUsd: 554,
  },
];
