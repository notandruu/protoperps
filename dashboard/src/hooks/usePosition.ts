'use client';

import useSWR from 'swr';
import { useTrader } from './useTrader';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const fetcher = (url: string) => fetch(url).then(r => r.json());

export interface PositionData {
  market: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  collateral: number;
  realizedPnl: number;
}

function mapRow(p: Record<string, unknown>): PositionData {
  return {
    market:      String(p.market ?? ''),
    side:        (p.side as 'long' | 'short') ?? 'long',
    size:        Number(p.size ?? 0),
    entryPrice:  Number(p.entry_price ?? 0),
    collateral:  Number(p.collateral ?? 0),
    realizedPnl: Number(p.realized_pnl ?? 0),
  };
}

/** Single market position for the current trader. */
export function usePosition(symbol: string | null) {
  const { traderId } = useTrader();

  return useSWR<PositionData | null>(
    traderId && symbol ? `${API_URL}/positions/${traderId}/${symbol}` : null,
    async (url: string) => {
      const data = await fetcher(url);
      if (!data || Number(data.size ?? 0) === 0) return null;
      return mapRow(data);
    },
    { refreshInterval: 3000 },
  );
}

/** All open positions across every market for the current trader. */
export function useAllPositions() {
  const { traderId } = useTrader();

  return useSWR<PositionData[]>(
    traderId ? `${API_URL}/positions/${traderId}` : null,
    async (url: string) => {
      const data = await fetcher(url);
      if (!Array.isArray(data)) return [];
      return (data as Record<string, unknown>[]).map(mapRow).filter(p => p.size > 0);
    },
    { refreshInterval: 5000 },
  );
}
