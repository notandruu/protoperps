'use client';

import { useMarginAccount } from '@/hooks/useMarginAccount';
import { formatUsdc } from '@/lib/math';
import { cn } from '@/lib/utils';
import { Wallet } from 'lucide-react';

export default function MarginCard() {
  const { data: margin, isLoading } = useMarginAccount();

  const deposited = margin?.usdcDeposited ?? 0;
  const locked = margin?.usdcLocked ?? 0;
  const free = margin?.free ?? 0;
  const utilizationPct = deposited > 0 ? (locked / deposited) * 100 : 0;

  const barColor =
    utilizationPct > 80 ? 'bg-red-500' :
    utilizationPct > 50 ? 'bg-yellow-500' :
    'bg-emerald-500';

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
          <h2 className="text-sm font-semibold text-foreground">Margin Account</h2>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-3 gap-6 animate-pulse">
            {[1,2,3].map(i => (
              <div key={i}>
                <div className="h-3 w-16 bg-muted rounded mb-2" />
                <div className="h-7 w-24 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : margin === null ? (
          <p className="text-muted-foreground text-sm">No margin account yet. Deposit USDC to get started.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Total Balance</div>
                <div className="text-2xl font-mono font-bold text-foreground tabular-nums">{formatUsdc(deposited)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Free Margin</div>
                <div className="text-2xl font-mono font-bold text-emerald-500 tabular-nums">{formatUsdc(free)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Used Margin</div>
                <div className="text-2xl font-mono font-bold text-foreground tabular-nums">{formatUsdc(locked)}</div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>Margin Utilization</span>
                <span className={cn(
                  'font-mono',
                  utilizationPct > 80 ? 'text-red-500' :
                  utilizationPct > 50 ? 'text-yellow-500' :
                  'text-emerald-500'
                )}>{utilizationPct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', barColor)}
                  style={{ width: `${Math.min(100, utilizationPct)}%` }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
