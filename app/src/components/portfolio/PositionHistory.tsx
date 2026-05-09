'use client';

import Link from 'next/link';
import { useAllPositions, PositionData } from '@/hooks/usePosition';
import { MARKETS } from '@/lib/constants';
import { formatSize, formatPrice, formatPnl, pnlClass, calcUnrealizedPnl } from '@/lib/math';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';
import { CompanyLogo } from '@/components/ui/company-logo';
import { useOracle } from '@/hooks/useOracle';


function PositionRow({ pos }: { pos: PositionData }) {
  const market = MARKETS.find(m => m.marketPubkey.toBase58() === pos.market.toBase58());
  const { data: oracle } = useOracle(market?.marketPubkey ?? null);
  const markPrice = oracle?.price ?? 0;

  const upnl = markPrice > 0
    ? calcUnrealizedPnl(pos.entryPrice, markPrice, pos.size, pos.side)
    : null;

  return (
    <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
      {/* Market */}
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <CompanyLogo symbol={market?.symbol ?? ''} size={32} />
          <div>
            <div className="text-sm font-medium text-foreground">{market?.name ?? 'Unknown'}</div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{market?.symbol}-PERP</div>
          </div>
        </div>
      </td>

      {/* Side */}
      <td className="px-5 py-4">
        <span className={cn(
          'px-2.5 py-1 rounded text-xs font-medium border',
          pos.side === 'long'
            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
            : 'bg-red-500/10 text-red-500 border-red-500/20'
        )}>
          {pos.side === 'long' ? 'Long' : 'Short'}
        </span>
      </td>

      {/* Size */}
      <td className="px-5 py-4 text-right font-mono text-sm text-foreground tabular-nums">
        {formatSize(pos.size)}
      </td>

      {/* Entry Price */}
      <td className="px-5 py-4 text-right font-mono text-sm text-foreground tabular-nums">
        {formatPrice(pos.entryPrice)}
      </td>

      {/* Mark Price */}
      <td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground tabular-nums">
        {markPrice > 0 ? formatPrice(markPrice) : '—'}
      </td>

      {/* Unrealized PnL */}
      <td className={cn(
        'px-5 py-4 text-right font-mono text-sm font-medium tabular-nums',
        upnl === null ? 'text-muted-foreground' : pnlClass(upnl)
      )}>
        {upnl === null ? '—' : formatPnl(upnl)}
      </td>

      {/* Collateral */}
      <td className="px-5 py-4 text-right font-mono text-sm text-muted-foreground tabular-nums">
        {formatPrice(pos.collateral)}
      </td>

      {/* Action */}
      <td className="px-5 py-4 text-right">
        {market?.symbol && (
          <Link href={`/trade/${market.symbol}`}>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Trade →
            </Button>
          </Link>
        )}
      </td>
    </tr>
  );
}

export default function PositionHistory() {
  const { data: positions, isLoading } = useAllPositions();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        </div>
        <div className="divide-y divide-border">
          {[1,2,3].map(i => (
            <div key={i} className="px-6 py-4 flex gap-4 animate-pulse">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-4 w-16 bg-muted rounded" />
              <div className="h-4 w-20 bg-muted rounded ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const openPositions = (positions ?? []).filter(p => p.size > 0);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Open Positions</h2>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {openPositions.length} position{openPositions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {openPositions.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm mb-4">No open positions.</p>
          <Link href="/">
            <Button variant="outline" size="sm">Browse Markets →</Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto hide-scrollbar">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground">Market</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Side</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Size</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Entry</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Mark</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Unrealized PnL</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Collateral</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map(pos => (
                <PositionRow key={pos.pubkey.toBase58()} pos={pos} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
