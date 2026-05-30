'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTrader } from '@/hooks/useTrader';
import { MarketData } from '@/hooks/useMarket';
import { PRICE_PRECISION, LOT_PRECISION, API_URL } from '@/lib/constants';
import { formatUsdc } from '@/lib/math';

interface OrderEntryProps {
  symbol: string;
  marketData: MarketData | null | undefined;
  markPrice: number;
}

type OrderType = 'limit' | 'market';
type Side = 'long' | 'short';

export default function OrderEntry({ symbol, markPrice }: OrderEntryProps) {
  const { traderId } = useTrader();

  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [side, setSide] = useState<Side>('long');
  const [limitPrice, setLimitPrice] = useState('');
  const [limitPriceTouched, setLimitPriceTouched] = useState(false);
  const [sizeUsd, setSizeUsd] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Keep limit price synced to mark price until user edits it.
  useEffect(() => {
    if (!limitPriceTouched && markPrice > 0) {
      setLimitPrice((markPrice / PRICE_PRECISION).toFixed(2));
    }
  }, [markPrice, limitPriceTouched]);

  const effectivePrice =
    orderType === 'market'
      ? side === 'long'
        ? Math.round(markPrice * 1.01)
        : Math.round(markPrice * 0.99)
      : Math.round(parseFloat(limitPrice || '0') * PRICE_PRECISION);

  const rawSize =
    sizeUsd && effectivePrice > 0
      ? Math.round((parseFloat(sizeUsd) * leverage * LOT_PRECISION * PRICE_PRECISION) / effectivePrice)
      : 0;

  const requiredCollateral =
    rawSize > 0 && effectivePrice > 0
      ? Math.round((effectivePrice * rawSize) / LOT_PRECISION / leverage)
      : 0;

  const handleSubmit = useCallback(async () => {
    if (!traderId) { setError('Set a trader ID in the header first'); return; }
    if (effectivePrice <= 0 || rawSize <= 0) { setError('Price and size must be > 0'); return; }

    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/orders/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trader:     traderId,
          market:     symbol,
          side,
          order_type: orderType === 'market' ? 'market' : 'limit',
          price:      effectivePrice,
          size:       rawSize,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail ?? `HTTP ${res.status}`);
      }
      setSuccess('Order accepted');
      setSizeUsd('');
      setLimitPriceTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [traderId, symbol, side, orderType, effectivePrice, rawSize]);

  if (!traderId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4 text-center">
        Set your trader ID in the header to place orders
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Order type tabs */}
      <div className="flex rounded-lg overflow-hidden border border-border">
        {(['limit', 'market'] as OrderType[]).map(t => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`flex-1 py-1.5 text-sm capitalize transition-colors ${
              orderType === t
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Side buttons */}
      <div className="flex gap-2">
        {(['long', 'short'] as Side[]).map(s => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
              side === s
                ? s === 'long'
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-500'
                  : 'bg-red-500/15 border-red-500/50 text-red-500'
                : s === 'long'
                ? 'border-border text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-500'
                : 'border-border text-muted-foreground hover:border-red-500/40 hover:text-red-500'
            }`}
          >
            {s === 'long' ? 'Long' : 'Short'}
          </button>
        ))}
      </div>

      {/* Limit price input */}
      {orderType === 'limit' && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Limit Price (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
            <input
              type="number"
              value={limitPrice}
              onChange={e => { setLimitPrice(e.target.value); setLimitPriceTouched(true); }}
              placeholder={(markPrice / PRICE_PRECISION).toFixed(2)}
              className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring font-mono"
            />
          </div>
        </div>
      )}

      {/* Size input */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1.5">Size (USD notional)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
          <input
            type="number"
            value={sizeUsd}
            onChange={e => setSizeUsd(e.target.value)}
            placeholder="0.00"
            className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring font-mono"
          />
        </div>
      </div>

      {/* Leverage */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Leverage</div>
        <div className="flex gap-1.5">
          {[1, 5, 10, 25, 50].map(l => (
            <button
              key={l}
              onClick={() => setLeverage(l)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                leverage === l
                  ? 'bg-primary/10 border-primary/50 text-primary'
                  : 'bg-muted border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
              }`}
            >
              {l}x
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Required Collateral</span>
          <span className="font-mono">{requiredCollateral > 0 ? formatUsdc(requiredCollateral) : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry Price</span>
          <span className="font-mono">
            {effectivePrice > 0 ? `$${(effectivePrice / PRICE_PRECISION).toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Trader</span>
          <span className="font-mono text-muted-foreground truncate max-w-[120px]">{traderId}</span>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}
      {success && (
        <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{success}</div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !sizeUsd || parseFloat(sizeUsd) <= 0 || (orderType === 'limit' && !limitPrice)}
        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          side === 'long'
            ? 'bg-emerald-500 text-white hover:bg-emerald-600'
            : 'bg-red-500 text-white hover:bg-red-600'
        }`}
      >
        {submitting ? 'Placing order…' : `Place ${side === 'long' ? 'Long' : 'Short'}`}
      </button>
    </div>
  );
}
