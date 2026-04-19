'use client';

import { MarketData } from '@/hooks/useMarket';
import { PRICE_PRECISION, LOT_PRECISION } from '@/lib/constants';

interface OrderBookProps {
  market: MarketData | null | undefined;
  markPrice: number;
}

function OrderRow({
  price,
  size,
  total,
  maxTotal,
  side,
}: {
  price: number;
  size: number;
  total: number;
  maxTotal: number;
  side: 'bid' | 'ask';
}) {
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const bgColor = side === 'bid' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
  const textColor = side === 'bid' ? 'text-long' : 'text-short';

  return (
    <div className="relative flex items-center px-3 py-0.5 text-xs font-mono hover:bg-surface-2 transition-colors">
      <div
        className="absolute inset-y-0 right-0"
        style={{ width: `${pct}%`, background: bgColor }}
      />
      <span className={`w-1/3 ${textColor} relative`}>
        {(price / PRICE_PRECISION).toFixed(2)}
      </span>
      <span className="w-1/3 text-center text-slate-300 relative">
        {(size / LOT_PRECISION).toFixed(4)}
      </span>
      <span className="w-1/3 text-right text-text-muted relative">
        {(total / PRICE_PRECISION).toFixed(2)}
      </span>
    </div>
  );
}

export default function OrderBook({ market, markPrice }: OrderBookProps) {
  const asks = market?.asks.slice().reverse() ?? []; // highest ask first for display
  const bids = market?.bids ?? [];

  // Compute cumulative sizes
  const askRows = asks.map((o, i) => ({
    price: o.price,
    size: o.size,
    total: asks.slice(i).reduce((acc, a) => acc + (a.price * a.size) / LOT_PRECISION, 0),
  }));
  const bidRows = bids.map((o, i) => ({
    price: o.price,
    size: o.size,
    total: bids.slice(0, i + 1).reduce((acc, b) => acc + (b.price * b.size) / LOT_PRECISION, 0),
  }));

  const maxTotal = Math.max(
    askRows[0]?.total ?? 0,
    bidRows[bidRows.length - 1]?.total ?? 0,
  );

  const spread = asks.length > 0 && bids.length > 0
    ? asks[asks.length - 1].price - bids[0].price
    : 0;
  const spreadPct = bids[0]?.price ? (spread / bids[0].price) * 100 : 0;

  const displayAsks = askRows.slice(-10);
  const displayBids = bidRows.slice(0, 10);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Order Book</h3>
      </div>

      {/* Column headers */}
      <div className="flex px-3 py-1 text-xs text-text-muted font-medium border-b border-border">
        <span className="w-1/3">Price</span>
        <span className="w-1/3 text-center">Size</span>
        <span className="w-1/3 text-right">Total</span>
      </div>

      {/* Asks (sells) — displayed top to bottom, highest first */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {displayAsks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
            No asks
          </div>
        ) : (
          displayAsks.map((row, i) => (
            <OrderRow
              key={i}
              price={row.price}
              size={row.size}
              total={row.total}
              maxTotal={maxTotal}
              side="ask"
            />
          ))
        )}
      </div>

      {/* Spread / Mark price */}
      <div className="flex items-center justify-between px-3 py-2 border-y border-border bg-surface">
        <span className="text-sm font-mono font-bold text-white">
          {markPrice > 0 ? `$${(markPrice / PRICE_PRECISION).toFixed(2)}` : '—'}
        </span>
        {spread > 0 && (
          <span className="text-xs text-text-muted">
            Spread: ${(spread / PRICE_PRECISION).toFixed(2)} ({spreadPct.toFixed(3)}%)
          </span>
        )}
      </div>

      {/* Bids (buys) */}
      <div className="flex-1 overflow-hidden">
        {displayBids.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-text-muted pt-4">
            No bids
          </div>
        ) : (
          displayBids.map((row, i) => (
            <OrderRow
              key={i}
              price={row.price}
              size={row.size}
              total={row.total}
              maxTotal={maxTotal}
              side="bid"
            />
          ))
        )}
      </div>
    </div>
  );
}
