'use client';

import { useMarginAccount } from '@/hooks/useMarginAccount';
import { formatUsdc } from '@/lib/math';

export default function MarginCard() {
  const { data: margin, isLoading } = useMarginAccount();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 animate-pulse">
        <div className="h-4 w-24 bg-surface-2 rounded mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i}>
              <div className="h-3 w-16 bg-surface-2 rounded mb-2" />
              <div className="h-6 w-20 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const deposited = margin?.usdcDeposited ?? 0;
  const locked = margin?.usdcLocked ?? 0;
  const free = margin?.free ?? 0;
  const utilizationPct = deposited > 0 ? (locked / deposited) * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
        Margin Account
      </h2>

      {margin === null ? (
        <p className="text-text-muted text-sm">No margin account yet. Deposit USDC to get started.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-6 mb-4">
            <div>
              <div className="text-xs text-text-muted mb-1">Total Balance</div>
              <div className="text-xl font-mono font-bold text-white">{formatUsdc(deposited)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted mb-1">Free Margin</div>
              <div className="text-xl font-mono font-bold text-long">{formatUsdc(free)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted mb-1">Used Margin</div>
              <div className="text-xl font-mono font-bold text-slate-300">{formatUsdc(locked)}</div>
            </div>
          </div>

          {/* Utilization bar */}
          <div className="mt-2">
            <div className="flex justify-between text-xs text-text-muted mb-1">
              <span>Margin Utilization</span>
              <span>{utilizationPct.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  utilizationPct > 80 ? 'bg-short' : utilizationPct > 50 ? 'bg-yellow-400' : 'bg-long'
                }`}
                style={{ width: `${Math.min(100, utilizationPct)}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
