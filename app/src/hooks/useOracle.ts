'use client';

import useSWR from 'swr';
import { PublicKey } from '@solana/web3.js';
import { usePrograms } from './usePrograms';
import { oraclePda } from '@/lib/constants';

export interface OracleData {
  price: number;
  status: number; // 0=Active, 1=ReduceOnly, 2=Paused
  lastUpdateTimestamp: number;
}

export function useOracle(marketPubkey: PublicKey | null) {
  const { connection } = usePrograms();

  return useSWR<OracleData | null>(
    marketPubkey ? ['oracle', marketPubkey.toBase58()] : null,
    async () => {
      const oracle = oraclePda(marketPubkey!);
      const info = await connection.getAccountInfo(oracle, 'confirmed');
      if (!info || info.data.length < 8 + 128) return null;
      const d = info.data;

      // status: offset 8+2
      const status = d[8 + 2];

      // price: u64 LE at offset 8+72
      const view = new DataView(d.buffer, d.byteOffset);
      const priceLo = view.getUint32(8 + 72, true);
      const priceHi = view.getUint32(8 + 76, true);
      const price = priceHi * 0x100000000 + priceLo;

      // last_update_timestamp: i64 LE at offset 8+120
      const tsLo = view.getUint32(8 + 120, true);
      const tsHi = view.getInt32(8 + 124, true);
      const lastUpdateTimestamp = tsHi * 0x100000000 + tsLo;

      return { price, status, lastUpdateTimestamp };
    },
    { refreshInterval: 5000 },
  );
}

/**
 * Return effective status accounting for staleness.
 *   -1 = oracle account not found (market not yet initialized on-chain)
 *    0 = Active
 *    1 = ReduceOnly
 *    2 = Paused (explicit admin pause or stale > 15 min)
 */
export function effectiveOracleStatus(oracle: OracleData | null | undefined): number {
  if (oracle === undefined) return -1; // still loading
  if (oracle === null) return -1;      // account does not exist on-chain
  const nowSecs = Date.now() / 1000;
  const age = nowSecs - oracle.lastUpdateTimestamp;
  const byStale = age >= 900 ? 2 : age >= 300 ? 1 : 0;
  return Math.max(oracle.status, byStale);
}
