import { PublicKey } from '@solana/web3.js';

export const PROTOPERPS_PROGRAM_ID = new PublicKey(
  'J65U84LyKvCtv76ynd4MBCfjQqTXLjHvFbpieVqRUjbW',
);

export const ORACLE_PROGRAM_ID = new PublicKey(
  'Bk1ao9hgiYxubch1XtrtaWTsYFscMqbH5QnahB6WLMZV',
);

/** All on-chain amounts are integers scaled by this factor. $1.00 = 1_000_000. */
export const PRICE_PRECISION = 1_000_000;
export const LOT_PRECISION = 1_000_000;
export const BPS_PRECISION = 10_000;
export const FUNDING_PRECISION = 1_000_000_000;

/** Devnet USDC mint — override with NEXT_PUBLIC_USDC_MINT env var if needed. */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? 'EKdgVqQVivDRiXeQfK2k2Yx1W2BZZdYJ8D1KEaouriEM',
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';

export interface MarketConfig {
  name: string;
  symbol: string;
  marketPubkey: PublicKey;
  tokenMint: string;
}

function marketPda(baseSymbol: string): PublicKey {
  const symbolBytes = Buffer.alloc(16);
  Buffer.from(baseSymbol, 'ascii').copy(symbolBytes);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), symbolBytes],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

export function oraclePda(marketPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle'), marketPubkey.toBuffer()],
    ORACLE_PROGRAM_ID,
  );
  return pda;
}

export function marginPda(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('margin'), owner.toBuffer()],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

export function positionPda(market: PublicKey, trader: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), market.toBuffer(), trader.toBuffer()],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

export function vaultAuthorityPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    PROTOPERPS_PROGRAM_ID,
  );
  return pda;
}

export const MARKETS: MarketConfig[] = [
  { name: 'SpaceX',     symbol: 'SPACEX', marketPubkey: marketPda('SPACEX'), tokenMint: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh' },
  { name: 'OpenAI',     symbol: 'OPENAI', marketPubkey: marketPda('OPENAI'), tokenMint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF' },
  { name: 'Anthropic',  symbol: 'ANTHRP', marketPubkey: marketPda('ANTHRP'), tokenMint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw' },
  { name: 'Anduril',    symbol: 'ANDURL', marketPubkey: marketPda('ANDURL'), tokenMint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB' },
  { name: 'Polymarket', symbol: 'POLMKT', marketPubkey: marketPda('POLMKT'), tokenMint: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP' },
  { name: 'Neuralink',  symbol: 'NRLNK',  marketPubkey: marketPda('NRLNK'),  tokenMint: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S' },
  { name: 'Kalshi',     symbol: 'KALSHI', marketPubkey: marketPda('KALSHI'), tokenMint: 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua' },
];

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  return MARKETS.find(m => m.symbol === symbol);
}
