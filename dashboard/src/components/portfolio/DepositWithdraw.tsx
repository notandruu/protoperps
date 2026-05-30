'use client';

import { useTrader } from '@/hooks/useTrader';
import { useAllPositions } from '@/hooks/usePosition';
import { PRICE_PRECISION } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';

export default function DepositWithdraw() {
  const { traderId } = useTrader();
  const { data: positions } = useAllPositions();

  const totalRealizedPnl = (positions ?? []).reduce((s, p) => s + p.realizedPnl, 0);
  const openCount = (positions ?? []).filter(p => p.size > 0).length;

  return (
    <div className="relative rounded-lg p-[1px] bg-border">
      <div
        className="absolute inset-0 rounded-lg bg-gradient-to-bl from-violet-500 via-violet-500/20 to-transparent opacity-80"
        style={{
          maskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
        }}
      />
      <div className="relative rounded-lg bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-foreground">Account</h2>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Trader ID</div>
            <div className={cn(
              'font-mono text-sm truncate',
              traderId ? 'text-foreground' : 'text-muted-foreground italic'
            )}>
              {traderId || 'not set'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
              <div className="font-mono text-sm text-foreground">{openCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Realized PnL</div>
              <div className={cn(
                'font-mono text-sm',
                totalRealizedPnl > 0 ? 'text-emerald-500' : totalRealizedPnl < 0 ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {totalRealizedPnl >= 0 ? '+' : ''}
                {(totalRealizedPnl / PRICE_PRECISION).toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Collateral is tracked per-position. Each position carries its own USDC collateral independently.
        </p>
      </div>
    </div>
  );
}
