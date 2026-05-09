'use client';

import useSWR from 'swr';

export interface DexStats {
  price: number;
  change24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txns24h: number;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useDexStats(tokenMint: string | null) {
  return useSWR<DexStats>(
    tokenMint ? `/api/dex/${tokenMint}` : null,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );
}
