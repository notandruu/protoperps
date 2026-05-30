'use client';

import { useTrader } from '@/hooks/useTrader';
import { useAllPositions } from '@/hooks/usePosition';
import { PRICE_PRECISION } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Wallet } from 'lucide-react';

export default function MarginCard() {
  const { traderId } = useTrader();
  const { data: positions, isLoading } = useAllPositions();

  const open = (positions ?? []).filter(p => p.size > 0);
  const totalCollateral = open.reduce((s, p) => s + p.collateral, 0);
  const totalRealizedPnl = (positions ?? []).reduce((s, p) => s + p.realizedPnl, 0);
  const totalNotional = open.reduce((s, p) => s + p.size, 0); // raw lots

  const pnlPositive = totalRealizedPnl >= 0;

  return (
    <div className="relative rounded-lg p-[1px] bg-border h-full">
      <div
        className="absolute inset-0 rounded-lg bg-gradient-to-bl from-emerald-500 via-emerald-500/20 to-transparent opacity-80"
        style={{
          maskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
        }}
      />
      <div className="relative rounded-lg bg-card p-6 h-full">
        <div className="flex items-center gap-2 mb-5">
          <Wallet className="h-4 w-4 text-emerald-500" />
          <h2 className="text-sm font-semibold text-foreground">Trading Account</h2>
          {traderId && (
            <span className="ml-auto font-mono text-xs text-muted-foreground truncate max-w-[140px]">
              {traderId}
            </span>
          )}
        </div>

        {!traderId ? (
          <p className="text-muted-foreground text-sm">Set a trader ID in the header to track your account.</p>
        ) : isLoading ? (
          <div className="grid grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i}>
                <div className="h-3 w-16 bg-muted rounded mb-2" />
                <div className="h-7 w-24 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
              <div className="text-2xl font-mono font-bold text-foreground tabular-nums">{open.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Total Collateral</div>
              <div className="text-2xl font-mono font-bold text-foreground tabular-nums">
                ${(totalCollateral / PRICE_PRECISION).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Realized PnL</div>
              <div className={cn(
                'text-2xl font-mono font-bold tabular-nums',
                pnlPositive ? 'text-emerald-500' : 'text-red-500',
              )}>
                {pnlPositive ? '+' : ''}
                ${Math.abs(totalRealizedPnl / PRICE_PRECISION).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
