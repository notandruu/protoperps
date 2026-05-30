'use client';

import { useRouter } from 'next/navigation';
import { MARKETS } from '@/lib/constants';
import { useOracle, effectiveOracleStatus } from '@/hooks/useOracle';
import { formatPrice } from '@/lib/math';
import { Button } from '@/components/ui/button';
import { SplitFlapText } from '@/components/ui/split-flap-text';
import { cn } from '@/lib/utils';
import { TrendingUp, Activity, Shield } from 'lucide-react';
import { CompanyLogo } from '@/components/ui/company-logo';
import { motion, AnimatePresence } from 'framer-motion';

function StatusDot({ status }: { status: number }) {
  if (status === 0) return <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />;
  if (status === 1) return <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500" />;
  if (status === 2) return <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />;
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />;
}

function MarketRow({ symbol, name, index }: { symbol: string; name: string; index: number }) {
  const router = useRouter();
  const { data: oracle, isLoading } = useOracle(symbol);
  const status = effectiveOracleStatus(oracle);
  const price = oracle?.price ?? 0;
  const priceStr = price > 0 ? formatPrice(price) : '———';

  return (
    <motion.tr
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.06, duration: 0.2 }}
      className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => router.push(`/trade/${symbol}`)}
    >
      <td className="py-4 px-4">
        <SplitFlapText value={symbol} charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" direction="flat" flipSpeedMs={40} />
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-2.5">
          <CompanyLogo symbol={symbol} size={28} />
          <span className="text-base text-muted-foreground truncate max-w-[140px]">{name}</span>
        </div>
      </td>
      <td className="py-4 px-4">
        {isLoading ? (
          <span className="text-base text-muted-foreground font-mono">…</span>
        ) : (
          <SplitFlapText value={priceStr} charset="0123456789.$," direction="flat" flipSpeedMs={40} />
        )}
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-1.5">
          <StatusDot status={status} />
          <span className="text-xs text-muted-foreground">
            {status === 0 ? 'Active' : status === 1 ? 'Reduce Only' : status === 2 ? 'Paused' : '—'}
          </span>
        </div>
      </td>
      <td className="py-4 px-4">
        <Button
          variant="outline"
          size="sm"
          disabled={status === 2}
          onClick={e => { e.stopPropagation(); router.push(`/trade/${symbol}`); }}
        >
          Trade →
        </Button>
      </td>
    </motion.tr>
  );
}

function OverviewCard({
  title, icon, accentColor, rows,
}: {
  title: string;
  icon: React.ReactNode;
  accentColor: 'emerald' | 'red' | 'blue' | 'violet';
  rows: { label: string; value: string }[];
}) {
  const gradientClass = {
    emerald: 'from-emerald-500 via-emerald-500/20 to-transparent',
    red:     'from-red-500 via-red-500/20 to-transparent',
    blue:    'from-blue-500 via-blue-500/20 to-transparent',
    violet:  'from-violet-500 via-violet-500/20 to-transparent',
  }[accentColor];

  const rowHighlightClass = {
    emerald: 'hover:bg-emerald-500/15',
    red:     'hover:bg-red-500/15',
    blue:    'hover:bg-blue-500/15',
    violet:  'hover:bg-violet-500/15',
  }[accentColor];

  return (
    <div className="relative rounded-lg p-[1px] bg-border">
      <div
        className={cn('absolute inset-0 rounded-lg bg-gradient-to-bl opacity-80', gradientClass)}
        style={{
          maskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
        }}
      />
      <div className="relative rounded-lg bg-card">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-border/50">
          {icon}
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        <ul className="px-3 py-2">
          {rows.map(r => (
            <li
              key={r.label}
              className={cn('flex items-center justify-between py-1.5 px-2 rounded-md transition-colors', rowHighlightClass)}
            >
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <span className="font-mono text-sm font-medium text-foreground tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function MarketsTable() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Watchlist</h2>
          <span className="text-xs text-muted-foreground">{MARKETS.length} markets</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto hide-scrollbar">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-36" />
                <col className="w-40" />
                <col className="w-36" />
                <col className="w-32" />
                <col className="w-24" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-2 px-4 text-left"><span className="text-xs font-semibold text-muted-foreground">Symbol</span></th>
                  <th className="py-2 px-4 text-left"><span className="text-xs font-semibold text-muted-foreground">Asset</span></th>
                  <th className="py-2 px-4 text-left"><span className="text-xs font-semibold text-muted-foreground">Mark Price</span></th>
                  <th className="py-2 px-4 text-left"><span className="text-xs font-semibold text-muted-foreground">Status</span></th>
                  <th className="py-2 px-4 text-left"><span className="text-xs font-semibold text-muted-foreground">Action</span></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {MARKETS.map((m, i) => (
                    <MarketRow key={m.symbol} symbol={m.symbol} name={m.name} index={i} />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Overview</h2>

        <OverviewCard
          title="Engine Params"
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          accentColor="emerald"
          rows={[
            { label: 'Max Leverage',  value: '50×' },
            { label: 'Init Margin',   value: '2%' },
            { label: 'Maint Margin',  value: '1%' },
            { label: 'Liq Reward',    value: '5%' },
            { label: 'Throughput',    value: '12,400/s' },
          ]}
        />

        <OverviewCard
          title="Oracle & Latency"
          icon={<Activity className="h-4 w-4 text-blue-500" />}
          accentColor="blue"
          rows={[
            { label: 'Oracle Source',   value: 'Pyth Network' },
            { label: 'Match p50',       value: '180 µs' },
            { label: 'E2E p99',         value: '8.1 ms' },
            { label: 'Stale → R/O',     value: '5 min' },
            { label: 'Stale → Pause',   value: '15 min' },
          ]}
        />

        <OverviewCard
          title="Infrastructure"
          icon={<Shield className="h-4 w-4 text-violet-500" />}
          accentColor="violet"
          rows={[
            { label: 'Engine',       value: 'Rust / tokio' },
            { label: 'Event bus',    value: 'Kafka' },
            { label: 'Hot state',    value: 'Redis 7' },
            { label: 'Persistence',  value: 'PostgreSQL 16' },
            { label: 'Deployment',   value: 'AWS EC2' },
          ]}
        />
      </div>
    </div>
  );
}
