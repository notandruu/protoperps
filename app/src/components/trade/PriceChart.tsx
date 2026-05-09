'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { OracleData } from '@/hooks/useOracle';
import { PRICE_PRECISION } from '@/lib/constants';

interface PricePoint {
  time: number;
  price: number;
}

interface PriceChartProps {
  oracle: OracleData | null | undefined;
  symbol: string;
  fundingRate?: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// For Y-axis tick labels — compact, no decimals on large prices
function formatTick(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 10)   return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}

// For the price header — always show cents
function formatHeaderPrice(v: number): string {
  if (v >= 10)  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${v.toFixed(3)}`;
}

// For price change — correct sign, enough decimals to never round to zero
function formatChange(v: number): string {
  const abs = Math.abs(v);
  if (v === 0) return '$0.00';
  let decimals = 2;
  if (abs < 0.01)   decimals = 4;
  if (abs < 0.0001) decimals = 6;
  const prefix = v > 0 ? '+$' : '-$';
  if (abs >= 10) return `${prefix}${abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  return `${prefix}${abs.toFixed(decimals)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as PricePoint;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{formatTime(point.time)}</div>
      <div className="text-foreground font-mono font-bold mt-0.5">{formatHeaderPrice(point.price)}</div>
    </div>
  );
};

export default function PriceChart({ oracle, symbol, fundingRate = 0 }: PriceChartProps) {
  const historyRef = useRef<PricePoint[]>([]);
  const [displayData, setDisplayData] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!oracle) return;
    const price = oracle.price / PRICE_PRECISION;
    const point: PricePoint = { time: Date.now(), price };
    historyRef.current = [...historyRef.current, point].slice(-120);
    setDisplayData([...historyRef.current]);
  }, [oracle]);

  const prices = displayData.map(p => p.price);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const currentPrice = oracle ? oracle.price / PRICE_PRECISION : 0;
  const firstPrice = displayData[0]?.price ?? currentPrice;

  // Enforce a minimum visible range so small moves aren't invisible
  const naturalRange = maxPrice - minPrice;
  const minRange = currentPrice * 0.006;
  const range = Math.max(naturalRange, minRange);
  const mid = (minPrice + maxPrice) / 2 || currentPrice;
  const yMin = Math.max(0, mid - range * 0.65);
  const yMax = mid + range * 0.65;

  const priceChange = currentPrice - firstPrice;
  const pricePct   = firstPrice !== 0 ? (priceChange / firstPrice) * 100 : 0;
  const isUp       = priceChange > 0 || (priceChange === 0 && fundingRate > 0);
  const isDown     = priceChange < 0 || (priceChange === 0 && fundingRate < 0);
  const color      = isUp ? '#22c55e' : isDown ? '#ef4444' : '#6b7280';
  const fillId     = `fill-${symbol}`;
  const muted      = '#6b7280';

  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Waiting for price data…
      </div>
    );
  }

  const changeStr = formatChange(priceChange);
  const pctStr    = pricePct === 0 ? '0.0000%' : `${pricePct > 0 ? '+' : ''}${pricePct.toFixed(4)}%`;

  return (
    <div className="flex flex-col gap-2 py-1">
      {/* Header */}
      <div className="flex items-baseline gap-3 px-3">
        <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
          {formatHeaderPrice(currentPrice)}
        </span>
        <span className={`text-sm font-mono tabular-nums ${isUp ? 'text-emerald-500' : isDown ? 'text-red-500' : 'text-muted-foreground'}`}>
          {changeStr}
        </span>
        <span className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${isUp ? 'bg-emerald-500/10 text-emerald-500' : isDown ? 'bg-red-500/10 text-red-500' : 'bg-muted text-muted-foreground'}`}>
          {pctStr}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          Live · {displayData.length < 120 ? `${displayData.length} pts` : '10 min'}
        </span>
      </div>

      {/* Chart — fixed height avoids ResponsiveContainer feedback loop */}
      <div style={{ height: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={displayData} margin={{ top: 32, right: 12, bottom: 8, left: -20 }}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid horizontal vertical={false} stroke="rgba(255,255,255,0.04)" />

            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              tick={{ fill: muted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={80}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: muted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatTick}
              width={72}
              tickCount={6}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />

            {firstPrice > 0 && (
              <ReferenceLine
                y={firstPrice}
                stroke="rgba(255,255,255,0.12)"
                strokeDasharray="4 4"
              />
            )}

            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${fillId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
