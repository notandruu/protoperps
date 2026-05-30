'use client';

// Dexscreener / Prestocks oracle removed — price comes from Pyth via the engine.
export interface DexStats {
  price: number;
  change24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txns24h: number;
}

export function useDexStats(_tokenMint: string | null) {
  return { data: undefined as DexStats | undefined, isLoading: false, error: null };
}
