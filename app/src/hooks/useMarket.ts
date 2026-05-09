'use client';

import useSWR from 'swr';
import { PublicKey } from '@solana/web3.js';
import { usePrograms } from './usePrograms';

export interface OrderEntry {
  price: number;
  size: number;
  sequenceNumber: number;
  trader: PublicKey;
  active: boolean;
  side: number; // 0=Bid, 1=Ask
  orderType: number;
}

export interface MarketData {
  authority: PublicKey;
  baseSymbol: string;
  oracle: PublicKey;
  maintenanceMarginRatio: number;
  liqRewardBps: number;
  fundingInterval: number;
  lastFundingTimestamp: number;
  cumulativeFundingRate: number;
  openInterest: number;
  numBids: number;
  numAsks: number;
  bids: OrderEntry[];
  asks: OrderEntry[];
}

function parseOrder(raw: Record<string, unknown>): OrderEntry {
  return {
    price: Number(raw.price?.toString() ?? 0),
    size: Number(raw.size?.toString() ?? 0),
    sequenceNumber: Number(raw.sequenceNumber?.toString() ?? raw.sequence_number?.toString() ?? 0),
    trader: raw.trader as PublicKey,
    active: Boolean(raw.active),
    side: Number(raw.side),
    orderType: Number(raw.orderType ?? raw.order_type ?? 0),
  };
}

export function useMarket(marketPubkey: PublicKey | null) {
  const { program } = usePrograms();

  return useSWR<MarketData | null>(
    program && marketPubkey ? ['market', marketPubkey.toBase58()] : null,
    async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mkt = await (program!.account as any).market.fetch(marketPubkey!);
        const numBids: number = mkt.numBids ?? mkt.num_bids ?? 0;
        const numAsks: number = mkt.numAsks ?? mkt.num_asks ?? 0;
        const rawBids: Record<string, unknown>[] = mkt.bids ?? [];
        const rawAsks: Record<string, unknown>[] = mkt.asks ?? [];

        return {
          authority: mkt.authority as PublicKey,
          baseSymbol: Buffer.from(mkt.baseSymbol ?? mkt.base_symbol ?? []).toString('utf8').replace(/\0/g, ''),
          oracle: mkt.oracle as PublicKey,
          maintenanceMarginRatio: Number(mkt.maintenanceMarginRatio?.toString() ?? mkt.maintenance_margin_ratio?.toString() ?? 1000),
          liqRewardBps: Number(mkt.liqRewardBps?.toString() ?? mkt.liq_reward_bps?.toString() ?? 500),
          fundingInterval: Number(mkt.fundingInterval?.toString() ?? mkt.funding_interval?.toString() ?? 3600),
          lastFundingTimestamp: Number(mkt.lastFundingTimestamp?.toString() ?? mkt.last_funding_timestamp?.toString() ?? 0),
          cumulativeFundingRate: Number(mkt.cumulativeFundingRate?.toString() ?? mkt.cumulative_funding_rate?.toString() ?? 0),
          openInterest: Number(mkt.openInterest?.toString() ?? mkt.open_interest?.toString() ?? 0),
          numBids,
          numAsks,
          bids: rawBids.slice(0, numBids).filter(o => o.active).map(parseOrder),
          asks: rawAsks.slice(0, numAsks).filter(o => o.active).map(parseOrder),
        };
      } catch {
        return null;
      }
    },
    { refreshInterval: 4000 },
  );
}
