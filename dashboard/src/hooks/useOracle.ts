'use client';

import useSWR from 'swr';
import { API_URL } from '@/lib/constants';

export interface OracleData {
  price: number;
  status: number; // 0=Active, 1=ReduceOnly, 2=Paused
  lastUpdateTimestamp: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useOracle(symbol: string | null) {
  return useSWR<OracleData | null>(
    symbol ? `${API_URL}/orderbook/${symbol}/price` : null,
    async (url: string) => {
      const data = await fetcher(url);
      return {
        price:              data.price ?? 0,
        status:             data.status ?? 2,
        lastUpdateTimestamp: data.last_update_ts ?? 0,
      };
    },
    { refreshInterval: 2000 },
  );
}

export function effectiveOracleStatus(oracle: OracleData | null | undefined): number {
  if (oracle == null) return -1;
  return oracle.status;
}
