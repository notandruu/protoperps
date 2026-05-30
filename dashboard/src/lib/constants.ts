/** All on-chain amounts are integers scaled by this factor. $1.00 = 1_000_000. */
export const PRICE_PRECISION = 1_000_000;
export const LOT_PRECISION   = 1_000_000;
export const BPS_PRECISION   = 10_000;
export const FUNDING_PRECISION = 1_000_000_000;

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export interface MarketConfig {
  name: string;
  symbol: string;
}

export const MARKETS: MarketConfig[] = [
  { name: 'Bitcoin',  symbol: 'BTCUSDT' },
  { name: 'Ethereum', symbol: 'ETHUSDT' },
  { name: 'Solana',   symbol: 'SOLUSDT' },
];

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  return MARKETS.find(m => m.symbol === symbol);
}
