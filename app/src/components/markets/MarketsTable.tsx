'use client';

import { useRouter } from 'next/navigation';
import { MARKETS } from '@/lib/constants';
import { useOracle, effectiveOracleStatus } from '@/hooks/useOracle';
import { useMarket } from '@/hooks/useMarket';
import { formatPrice, formatCompact, formatChange } from '@/lib/math';
import { useDexStats } from '@/hooks/useDexStats';
import { PRICE_PRECISION } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { SplitFlapText } from '@/components/ui/split-flap-text';
import { DirectionIcon } from '@/components/ui/direction-icon';
import { cn } from '@/lib/utils';
import { TrendingUp, Activity, Shield, Trash2 } from 'lucide-react';
import { CompanyLogo } from '@/components/ui/company-logo';
import { motion, AnimatePresence } from 'framer-motion';

// ── Per-market accent colours ────────────────────────────────────────────────
const MARKET_GRAD: Record<string, string> = {
  SPACEX: 'from-[#005288] via-[#005288]/20 to-transparent',
  OPENAI: 'from-[#10a37f] via-[#10a37f]/20 to-transparent',
  ANTHRP: 'from-[#c96442] via-[#c96442]/20 to-transparent',
  ANDURL: 'from-[#f04e23] via-[#f04e23]/20 to-transparent',
  POLMKT: 'from-[#6031b6] via-[#6031b6]/20 to-transparent',
  NRLNK:  'from-[#00c7e6] via-[#00c7e6]/20 to-transparent',
  KALSHI: 'from-[#05c168] via-[#05c168]/20 to-transparent',
};

// ── Single market row (table row) ────────────────────────────────────────────
function MarketRow({ symbol, name, marketPubkey, tokenMint, index }: {
  symbol: string;
  name: string;
  marketPubkey: import('@solana/web3.js').PublicKey;
  tokenMint: string;
  index: number;
}) {
  const router = useRouter();
  const { data: oracle, isLoading } = useOracle(marketPubkey);
  const { data: market } = useMarket(marketPubkey);
  const { data: dex } = useDexStats(tokenMint);
  const status = effectiveOracleStatus(oracle);

  const price = oracle?.price ?? 0;
  const fundingRate = market?.cumulativeFundingRate ?? 0;

  const direction: 'up' | 'down' | 'flat' =
    fundingRate > 0 ? 'up' : fundingRate < 0 ? 'down' : 'flat';

  const priceStr = price > 0 ? formatPrice(price) : '———';
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
            direction="flat"
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
            direction="flat"
            flipSpeedMs={40}
          />
        )}
      </td>

      {/* 24h % */}
      <td className="py-4 pl-8 pr-4 hidden md:table-cell">
        {dex ? (
          <span className={cn('text-sm font-mono tabular-nums', dex.change24h >= 0 ? 'text-emerald-500' : 'text-red-500')}>
            {formatChange(dex.change24h)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>

      {/* Volume 24h */}
      <td className="py-4 pl-8 pr-4 hidden lg:table-cell">
        <span className="text-sm font-mono tabular-nums text-muted-foreground">
          {dex ? formatCompact(dex.volume24h) : '—'}
        </span>
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

// ── Main export ───────────────────────────────────────────────────────────────
export default function MarketsTable() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

      {/* Watchlist table */}
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
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-28 hidden md:table-column" />
                <col className="w-32 hidden lg:table-column" />
                <col className="w-24" />
              </colgroup>
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
                  <th className="py-2 pl-8 pr-3 text-left hidden md:table-cell">
                    <span className="text-xs font-semibold text-muted-foreground">24h %</span>
                  </th>
                  <th className="py-2 pl-8 pr-3 text-left hidden lg:table-cell">
                    <span className="text-xs font-semibold text-muted-foreground">Volume 24h</span>
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
                      tokenMint={m.tokenMint}
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stats sidebar */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Overview</h2>

        <OverviewCard
          title="Protocol Params"
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          accentColor="emerald"
          rows={[
            { label: 'Max Leverage', value: '50×' },
            { label: 'Init Margin',  value: '2%' },
            { label: 'Maint Margin', value: '1%' },
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
