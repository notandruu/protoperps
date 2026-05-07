'use client';

import { useParams } from 'next/navigation';
import { getMarketBySymbol } from '@/lib/constants';
import { useOracle, effectiveOracleStatus } from '@/hooks/useOracle';
import { useMarket } from '@/hooks/useMarket';
import { usePosition } from '@/hooks/usePosition';
import PriceChart from '@/components/trade/PriceChart';
import OrderBook from '@/components/trade/OrderBook';
import OrderEntry from '@/components/trade/OrderEntry';
import PositionsTable from '@/components/trade/PositionsTable';
import { formatPrice, formatFundingRate } from '@/lib/math';
import { PRICE_PRECISION, LOT_PRECISION } from '@/lib/constants';

function StatusBadge({ status }: { status: number }) {
  const label =
    status === -1 ? 'Not Deployed'
    : status === 0 ? 'Active'
    : status === 1 ? 'Reduce Only'
    : 'Paused';
  const cls =
    status === -1 ? 'bg-surface-2 text-text-muted border-border'
    : status === 0 ? 'bg-long/20 text-long border-long/30'
    : status === 1 ? 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30'
    : 'bg-short/20 text-short border-short/30';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

function StatItem({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className={`text-sm font-mono font-medium mt-0.5 ${valueClass || 'text-white'}`}>{value}</div>
    </div>
  );
}

export default function TradePage() {
  const params = useParams();
  const symbol = (params.symbol as string).toUpperCase();
  const market = getMarketBySymbol(symbol);

  const { data: oracle } = useOracle(market?.marketPubkey ?? null);
  const { data: marketData, mutate: refreshMarket } = useMarket(market?.marketPubkey ?? null);
  const { data: position, mutate: refreshPosition } = usePosition(market?.marketPubkey ?? null);

  const oracleStatus = effectiveOracleStatus(oracle);
  const markPrice = oracle?.price ?? 0;
  const fundingRate = marketData?.cumulativeFundingRate ?? 0;
  const openInterest = marketData?.openInterest ?? 0;
  const openInterestUsd = openInterest > 0 && markPrice > 0
    ? (openInterest / LOT_PRECISION) * (markPrice / PRICE_PRECISION)
    : 0;

  if (!market) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        Market &ldquo;{symbol}&rdquo; not found.
      </div>
    );
  }

  return (
    <div>
      {/* Market header */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm font-bold text-slate-400">
              {symbol.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{market.name}</h1>
              <div className="text-xs text-text-muted">{symbol}-PERP</div>
            </div>
          </div>
        </div>

        <StatusBadge status={oracleStatus} />

        <div className="flex gap-6 ml-4">
          <StatItem
            label="Mark Price"
            value={markPrice > 0 ? formatPrice(markPrice) : '—'}
          />
          <StatItem
            label="Funding Rate"
            value={formatFundingRate(fundingRate)}
            valueClass={fundingRate >= 0 ? 'text-long' : 'text-short'}
          />
          <StatItem
            label="Open Interest"
            value={openInterestUsd > 0 ? `$${openInterestUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
          />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: '600px' }}>
        {/* Price chart — 8 cols */}
        <div className="col-span-12 lg:col-span-8 rounded-xl border border-border bg-surface p-4" style={{ height: '380px' }}>
          <PriceChart oracle={oracle} symbol={symbol} />
        </div>

        {/* Order entry — 4 cols */}
        <div className="col-span-12 lg:col-span-4 rounded-xl border border-border bg-surface" style={{ height: '380px', overflowY: 'auto' }}>
          <div className="px-4 pt-4 pb-2 border-b border-border">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Place Order</h3>
          </div>
          <OrderEntry
            marketPubkey={market.marketPubkey}
            marketData={marketData}
            markPrice={markPrice}
          />
        </div>

        {/* Orderbook — 4 cols */}
        <div className="col-span-12 lg:col-span-4 rounded-xl border border-border bg-surface" style={{ height: '360px', overflowY: 'hidden' }}>
          <OrderBook market={marketData} markPrice={markPrice} />
        </div>

        {/* Positions — 8 cols */}
        <div className="col-span-12 lg:col-span-8 rounded-xl border border-border bg-surface">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">My Position</h3>
          </div>
          <PositionsTable
            marketPubkey={market.marketPubkey}
            position={position}
            markPrice={markPrice}
            marketData={marketData}
            onClose={() => {
              refreshPosition();
              refreshMarket();
            }}
          />
        </div>
      </div>
    </div>
  );
}
