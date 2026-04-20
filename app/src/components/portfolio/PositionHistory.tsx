'use client';

import Link from 'next/link';
import { useAllPositions } from '@/hooks/usePosition';
import { MARKETS } from '@/lib/constants';
import { formatSize, formatPrice, formatPnl, pnlClass } from '@/lib/math';

export default function PositionHistory() {
  const { data: positions, isLoading } = useAllPositions();

  function getMarketName(marketKey: string): string {
    const m = MARKETS.find(m => m.marketPubkey.toBase58() === marketKey);
    return m ? `${m.name} (${m.symbol}-PERP)` : marketKey.slice(0, 8) + '…';
  }

  function getMarketSymbol(marketKey: string): string {
    return MARKETS.find(m => m.marketPubkey.toBase58() === marketKey)?.symbol ?? '';
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <div className="h-4 w-32 bg-surface-2 rounded animate-pulse" />
        </div>
        <div className="divide-y divide-border">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-6 py-4 flex gap-4 animate-pulse">
              <div className="h-4 w-24 bg-surface-2 rounded" />
              <div className="h-4 w-16 bg-surface-2 rounded" />
              <div className="h-4 w-20 bg-surface-2 rounded ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const openPositions = (positions ?? []).filter(p => p.size > 0);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">Open Positions</h2>
        <span className="text-xs text-text-muted">{openPositions.length} position{openPositions.length !== 1 ? 's' : ''}</span>
      </div>

      {openPositions.length === 0 ? (
        <div className="px-6 py-8 text-center text-text-muted text-sm">
          No open positions. Start trading on the{' '}
          <Link href="/" className="text-accent hover:underline">Markets</Link> page.
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-xs text-text-muted border-b border-border">
              <th className="px-6 py-2 text-left">Market</th>
              <th className="px-4 py-2 text-left">Side</th>
              <th className="px-4 py-2 text-right">Size</th>
              <th className="px-4 py-2 text-right">Entry Price</th>
              <th className="px-4 py-2 text-right">Collateral</th>
              <th className="px-4 py-2 text-right">Realized PnL</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {openPositions.map(pos => {
              const marketKey = pos.market.toBase58();
              const symbol = getMarketSymbol(marketKey);
              return (
                <tr key={pos.pubkey.toBase58()} className="hover:bg-surface-2 transition-colors">
                  <td className="px-6 py-3 text-sm text-white">{getMarketName(marketKey)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      pos.side === 'long'
                        ? 'bg-long/20 text-long'
                        : 'bg-short/20 text-short'
                    }`}>
                      {pos.side === 'long' ? 'Long' : 'Short'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
                    {formatSize(pos.size)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
                    {formatPrice(pos.entryPrice)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-slate-300">
                    {formatPrice(pos.collateral)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono text-sm font-medium ${pnlClass(pos.realizedPnl)}`}>
                    {formatPnl(pos.realizedPnl)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {symbol && (
                      <Link
                        href={`/trade/${symbol}`}
                        className="text-xs text-accent hover:underline"
                      >
                        Trade →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
