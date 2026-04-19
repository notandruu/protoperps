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
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as PricePoint;
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 text-xs">
      <div className="text-text-muted">{formatTime(point.time)}</div>
      <div className="text-white font-mono font-bold mt-0.5">
        ${point.price.toFixed(2)}
      </div>
    </div>
  );
};

export default function PriceChart({ oracle, symbol }: PriceChartProps) {
  const historyRef = useRef<PricePoint[]>([]);
  const [displayData, setDisplayData] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!oracle || oracle.price === 0) return;
    const price = oracle.price / PRICE_PRECISION;
    const point: PricePoint = { time: Date.now(), price };
    historyRef.current = [...historyRef.current, point].slice(-120);
    setDisplayData([...historyRef.current]);
  }, [oracle]);

  const prices = displayData.map(p => p.price);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const padding = (maxPrice - minPrice) * 0.1 || 1;
  const yMin = Math.max(0, minPrice - padding);
  const yMax = maxPrice + padding;

  const currentPrice = oracle ? oracle.price / PRICE_PRECISION : 0;
  const firstPrice = displayData[0]?.price ?? currentPrice;
  const priceChange = firstPrice > 0 ? currentPrice - firstPrice : 0;
  const isPositive = priceChange >= 0;
  const strokeColor = isPositive ? '#22c55e' : '#ef4444';
  const fillId = `fill-${symbol}`;

  if (displayData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Waiting for price data…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-2 pb-2">
        <span className="text-2xl font-mono font-bold text-white">
          {currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : '—'}
        </span>
        <span className={`text-sm font-mono ${isPositive ? 'text-long' : 'text-short'}`}>
          {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({firstPrice > 0 ? ((priceChange / firstPrice) * 100).toFixed(2) : '0.00'}%)
        </span>
        <span className="text-xs text-text-muted ml-auto">Live • ~30s history</span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={displayData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.15} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={80}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            {firstPrice > 0 && (
              <ReferenceLine
                y={firstPrice}
                stroke="#2a2a3a"
                strokeDasharray="4 4"
              />
            )}
            <Area
              type="monotone"
              dataKey="price"
              stroke={strokeColor}
              strokeWidth={1.5}
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
