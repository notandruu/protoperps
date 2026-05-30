'use client';

import useSWR from 'swr';
import { API_URL } from '@/lib/constants';

export interface OrderEntry {
  price: number;
  size: number;
}

export interface MarketData {
  market: string;
  bids: OrderEntry[];
  asks: OrderEntry[];
  timestamp: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useMarket(symbol: string | null) {
  return useSWR<MarketData | null>(
    symbol ? `${API_URL}/orderbook/${symbol}` : null,
    async (url: string) => {
      const d = await fetcher(url);
      return {
        market: symbol!,
        bids: (d.bids ?? []).map(([price, size]: number[]) => ({ price, size })),
        asks: (d.asks ?? []).map(([price, size]: number[]) => ({ price, size })),
        timestamp: d.timestamp ?? 0,
      };
    },
    { refreshInterval: 1000 },
  );
}
