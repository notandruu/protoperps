'use client';

import { useRouter } from 'next/navigation';
import { MARKETS } from '@/lib/constants';
import { useOracle, effectiveOracleStatus } from '@/hooks/useOracle';
import { useMarket } from '@/hooks/useMarket';
import { formatPrice, formatFundingRate } from '@/lib/math';
import { PRICE_PRECISION } from '@/lib/constants';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SplitFlapText } from '@/components/ui/split-flap-text';
import { DirectionIcon } from '@/components/ui/direction-icon';
import { ChangeBadge } from '@/components/ui/change-badge';
import { cn } from '@/lib/utils';
import { TrendingUp, Activity, Shield, Trash2 } from 'lucide-react';
import { CompanyLogo } from '@/components/ui/company-logo';
import { motion, AnimatePresence } from 'framer-motion';

// ── Per-market accent colours ────────────────────────────────────────────────
const MARKET_GRAD: Record<string, string> = {
  SPACEX: 'from-blue-500 via-blue-500/20 to-transparent',
  OPENAI: 'from-teal-500 via-teal-500/20 to-transparent',
  ANTHRP: 'from-orange-500 via-orange-500/20 to-transparent',
  ANDURL: 'from-red-500 via-red-500/20 to-transparent',
  POLMKT: 'from-purple-500 via-purple-500/20 to-transparent',
  NRLNK:  'from-cyan-500 via-cyan-500/20 to-transparent',
  KALSHI: 'from-violet-500 via-violet-500/20 to-transparent',
};

// ── Single market row (table row) ────────────────────────────────────────────
function MarketRow({ symbol, name, marketPubkey, index }: {
  symbol: string;
  name: string;
  marketPubkey: import('@solana/web3.js').PublicKey;
  index: number;
}) {
  const router = useRouter();
  const { data: oracle, isLoading } = useOracle(marketPubkey);
  const { data: market } = useMarket(marketPubkey);
  const status = effectiveOracleStatus(oracle);

  const price = oracle?.price ?? 0;
  const fundingRate = market?.cumulativeFundingRate ?? 0;

  const direction: 'up' | 'down' | 'flat' =
    fundingRate > 0 ? 'up' : fundingRate < 0 ? 'down' : 'flat';

  const priceStr = price > 0 ? formatPrice(price) : '———';
  const fundingPct = (fundingRate / 1e9) * 100;

  return (
    <motion.tr
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
      onClick={() => router.push(`/trade/${symbol}`)}
    >
      {/* Symbol */}
      <td className="py-4 px-4">
        <div className="flex items-center gap-2.5">
          <DirectionIcon direction={direction} />
          <SplitFlapText
            value={symbol}
            charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
            direction={direction}
            flipSpeedMs={40}
          />
        </div>
      </td>

      {/* Name */}
      <td className="py-4 px-4">
        <div className="flex items-center gap-2.5">
          <CompanyLogo symbol={symbol} size={28} />
          <span className="text-base text-muted-foreground truncate max-w-[140px]">{name}</span>
        </div>
      </td>

      {/* Price */}
      <td className="py-4 px-4">
        {isLoading ? (
          <span className="text-base text-muted-foreground font-mono">…</span>
        ) : (
          <SplitFlapText
            value={priceStr}
            charset="0123456789.$,"
            direction={direction}
            flipSpeedMs={40}
          />
        )}
      </td>

      {/* Funding */}
      <td className="py-4 px-4 hidden sm:table-cell">
        <ChangeBadge value={fundingPct} direction={direction} suffix="%" />
      </td>

      {/* Status */}
      <td className="py-4 px-4 hidden sm:table-cell">
        {status === 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />Active
          </span>
        )}
        {status === 1 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-yellow-500">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />Reduce Only
          </span>
        )}
        {status === 2 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-red-500">
            <span className="w-2 h-2 rounded-full bg-red-500" />Paused
          </span>
        )}
        {status === -1 && (
          <span className="text-sm text-muted-foreground">Not Deployed</span>
        )}
      </td>

      {/* Trade button */}
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

// ── Overview card — copied exactly from reference ─────────────────────────────
function OverviewCard({
  title,
  icon,
  accentColor,
  rows,
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
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ul className="space-y-1">
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
        </CardContent>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function MarketsTable() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* Watchlist table — 2/3 */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Watchlist</h2>
          <span className="text-xs text-muted-foreground">{MARKETS.length} markets</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto hide-scrollbar">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-2 px-3 text-left">
                    <span className="text-xs font-semibold text-muted-foreground">Symbol</span>
                  </th>
                  <th className="py-2 px-3 text-left">
                    <span className="text-xs font-semibold text-muted-foreground">Name</span>
                  </th>
                  <th className="py-2 px-3 text-left">
                    <span className="text-xs font-semibold text-muted-foreground">Mark Price</span>
                  </th>
                  <th className="py-2 px-3 text-left hidden sm:table-cell">
                    <span className="text-xs font-semibold text-muted-foreground">Funding</span>
                  </th>
                  <th className="py-2 px-3 text-left hidden sm:table-cell">
                    <span className="text-xs font-semibold text-muted-foreground">Status</span>
                  </th>
                  <th className="py-2 px-3 text-left">
                    <span className="text-xs font-semibold text-muted-foreground">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {MARKETS.map((m, i) => (
                    <MarketRow
                      key={m.symbol}
                      symbol={m.symbol}
                      name={m.name}
                      marketPubkey={m.marketPubkey}
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stats sidebar — 1/3 */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Overview</h2>

        <OverviewCard
          title="Protocol Params"
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          accentColor="emerald"
          rows={[
            { label: 'Max Leverage', value: '5×' },
            { label: 'Init Margin',  value: '20%' },
            { label: 'Maint Margin', value: '10%' },
            { label: 'Liq Reward',   value: '5%' },
            { label: 'Collateral',   value: 'USDC' },
          ]}
        />

        <OverviewCard
          title="Oracle & Funding"
          icon={<Activity className="h-4 w-4 text-blue-500" />}
          accentColor="blue"
          rows={[
            { label: 'Oracle Source',  value: 'Prestocks DEX' },
            { label: 'Funding Interval', value: '1 hour' },
            { label: 'Max Δ / update', value: '10%' },
            { label: 'Stale → R/O',   value: '5 min' },
            { label: 'Stale → Pause', value: '15 min' },
          ]}
        />

        <OverviewCard
          title="Risk & Settlement"
          icon={<Shield className="h-4 w-4 text-violet-500" />}
          accentColor="violet"
          rows={[
            { label: 'Margin Model', value: 'Isolated' },
            { label: 'Settlement',   value: 'USDC' },
            { label: 'Network',      value: 'Solana Devnet' },
            { label: 'Markets',      value: `${MARKETS.length} live` },
          ]}
        />
      </div>

    </div>
  );
}
