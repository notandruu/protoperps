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
import OpenOrders from '@/components/trade/OpenOrders';
import { CompanyLogo } from '@/components/ui/company-logo';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { formatPrice } from '@/lib/math';

const MARKET_GRAD: Record<string, string> = {
  BTCUSDT: 'from-[#f7931a]',
  ETHUSDT: 'from-[#627eea]',
  SOLUSDT: 'from-[#9945ff]',
};

function StatusBadge({ status }: { status: number }) {
  if (status === 0) return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Active
    </span>
  );
  if (status === 1) return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-yellow-500/15 text-yellow-500 border border-yellow-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />Reduce Only
    </span>
  );
  if (status === 2) return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-500/15 text-red-500 border border-red-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />Paused
    </span>
  );
  return <span className="px-2 py-0.5 rounded-md text-xs bg-muted text-muted-foreground border border-border">Loading</span>;
}

function Stat({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-mono font-medium mt-0.5 tabular-nums', valueClass || 'text-foreground')}>{value}</div>
    </div>
  );
}

function GradPanel({ gradFrom, children, className = '', style }: { gradFrom: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('relative rounded-lg p-[1px] bg-border group', className)} style={style}>
      <div
        className={cn('absolute inset-0 rounded-lg bg-gradient-to-bl opacity-60 transition-opacity duration-500', gradFrom, 'via-transparent to-transparent')}
        style={{
          maskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
        }}
      />
      <div className="relative rounded-lg bg-card h-full">{children}</div>
    </div>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-2.5 border-b border-border">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
    </div>
  );
}

export default function TradePage() {
  const params = useParams();
  const symbol = (params.symbol as string).toUpperCase();
  const market = getMarketBySymbol(symbol);

  const { data: oracle } = useOracle(symbol);
  const { data: marketData, mutate: refreshMarket } = useMarket(symbol);
  const { data: position, mutate: refreshPosition } = usePosition(symbol);

  const oracleStatus = effectiveOracleStatus(oracle);
  const markPrice = oracle?.price ?? 0;
  const fundingRate = 0; // funded by engine, not exposed in snapshot
  const openInterest = (marketData?.bids?.length ?? 0) + (marketData?.asks?.length ?? 0); // level count proxy

  const [bottomTab, setBottomTab] = useState<'position' | 'orders'>('position');
  const gradFrom = MARKET_GRAD[symbol] ?? 'from-violet-500';

  if (!market) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Market &ldquo;{symbol}&rdquo; not found.
      </div>
    );
  }

  return (
    <div className="pb-8 space-y-4">

      {/* Market header */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <CompanyLogo symbol={symbol} size={40} />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground leading-tight">{market.name}</h1>
            <div className="text-xs text-muted-foreground font-mono">{symbol}-PERP</div>
          </div>
        </div>

        <StatusBadge status={oracleStatus} />
        <div className="hidden sm:block h-8 w-px bg-border mx-1" />

        <div className="flex items-center gap-6 flex-wrap">
          <Stat label="Mark Price" value={markPrice > 0 ? formatPrice(markPrice) : '—'} />
          <div className="hidden sm:block h-6 w-px bg-border" />
          <Stat label="Oracle" value="Pyth Network" valueClass="text-muted-foreground" />
          <div className="hidden sm:block h-6 w-px bg-border" />
          <Stat label="Book Levels" value={String(openInterest)} />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-12 gap-4">

        <GradPanel gradFrom={gradFrom} className="col-span-12 lg:col-span-8">
          <PanelHeader title="Price Chart" />
          <div className="p-2">
            <PriceChart oracle={oracle} symbol={symbol} fundingRate={fundingRate} />
          </div>
        </GradPanel>

        <GradPanel gradFrom={gradFrom} className="col-span-12 lg:col-span-4">
          <PanelHeader title="Place Order" />
          <OrderEntry symbol={symbol} marketData={marketData} markPrice={markPrice} />
        </GradPanel>

        <GradPanel gradFrom={gradFrom} className="col-span-12 lg:col-span-4">
          <OrderBook market={marketData} markPrice={markPrice} />
        </GradPanel>

        <GradPanel gradFrom={gradFrom} className="col-span-12 lg:col-span-8">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-4">
            {(['position', 'orders'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setBottomTab(tab)}
                className={cn(
                  'text-xs font-semibold uppercase tracking-wider transition-colors',
                  bottomTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab === 'position' ? 'My Position' : 'Cancel Order'}
              </button>
            ))}
          </div>
          {bottomTab === 'position' ? (
            <PositionsTable
              symbol={symbol}
              position={position}
              markPrice={markPrice}
              onClose={() => { refreshPosition(); refreshMarket(); }}
            />
          ) : (
            <OpenOrders symbol={symbol} onCancel={() => refreshMarket()} />
          )}
        </GradPanel>

      </div>
    </div>
  );
}
