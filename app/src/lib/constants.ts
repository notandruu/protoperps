import { PublicKey } from '@solana/web3.js';

export const PROTOPERPS_PROGRAM_ID = new PublicKey(
  '2B3FDJu1myUaoeXuoWQ7MD8B5r1fr1BbSG4RX9GfHxDr',
);

export const ORACLE_PROGRAM_ID = new PublicKey(
  'Av4fWEvzFmn1NatYWbQw5HnWKesUfsnKDqwkhau4v7KQ',
);

/** All on-chain amounts are integers scaled by this factor. $1.00 = 1_000_000. */
export const PRICE_PRECISION = 1_000_000;
export const LOT_PRECISION = 1_000_000;
export const BPS_PRECISION = 10_000;
export const FUNDING_PRECISION = 1_000_000_000;

/** Devnet USDC mint — override with NEXT_PUBLIC_USDC_MINT env var if needed. */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';

export interface MarketConfig {
  name: string;
  symbol: string;
  marketPubkey: PublicKey;
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
  { name: 'SpaceX', symbol: 'SPACEX', marketPubkey: marketPda('SPACEX') },
  { name: 'OpenAI', symbol: 'OPENAI', marketPubkey: marketPda('OPENAI') },
  { name: 'Anthropic', symbol: 'ANTHRP', marketPubkey: marketPda('ANTHRP') },
  { name: 'Anduril', symbol: 'ANDURL', marketPubkey: marketPda('ANDURL') },
  { name: 'Polymarket', symbol: 'POLMKT', marketPubkey: marketPda('POLMKT') },
  { name: 'Neuralink', symbol: 'NRLNK', marketPubkey: marketPda('NRLNK') },
  { name: 'Kalshi', symbol: 'KALSHI', marketPubkey: marketPda('KALSHI') },
];

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  return MARKETS.find(m => m.symbol === symbol);
}
