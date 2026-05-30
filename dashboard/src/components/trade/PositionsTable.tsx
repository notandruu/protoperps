'use client';

import { useState, useCallback } from 'react';
import { useTrader } from '@/hooks/useTrader';
import { PositionData } from '@/hooks/usePosition';
import { API_URL, PRICE_PRECISION, LOT_PRECISION } from '@/lib/constants';
import {
  formatPrice,
  formatSize,
  formatPnl,
  pnlClass,
  calcUnrealizedPnl,
  calcLiquidationPrice,
} from '@/lib/math';

interface PositionsTableProps {
  symbol: string;
  position: PositionData | null | undefined;
  markPrice: number;
  onClose?: () => void;
}

export default function PositionsTable({ symbol, position, markPrice, onClose }: PositionsTableProps) {
  const { traderId } = useTrader();
  const [closing, setClosing] = useState(false);
  const [closeSize, setCloseSize] = useState('');
  const [error, setError] = useState('');

  const sendClose = useCallback(async (size: number) => {
    if (!traderId || !position) return;
    setError('');
    setClosing(true);
    try {
      const closeSide = position.side === 'long' ? 'short' : 'long';
      // Use aggressive price to guarantee fill
      const price =
        position.side === 'long'
          ? Math.round(markPrice * 0.97)
          : Math.round(markPrice * 1.03);

      const res = await fetch(`${API_URL}/orders/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trader:     traderId,
          market:     symbol,
          side:       closeSide,
          order_type: 'limit',
          price,
          size,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail ?? `HTTP ${res.status}`);
      }
      setCloseSize('');
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClosing(false);
    }
  }, [traderId, symbol, position, markPrice, onClose]);

  if (!traderId) {
    return (
      <div className="text-center text-muted-foreground text-sm py-6">
        Set a trader ID to view positions
      </div>
    );
  }

  if (!position || position.size === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm py-6">
        No open position in this market
      </div>
    );
  }

  const upnl = calcUnrealizedPnl(position.entryPrice, markPrice, position.size, position.side);
  const liqPrice = calcLiquidationPrice(position.entryPrice, position.size, position.collateral, position.side);
  const notional = (markPrice * position.size) / LOT_PRECISION;
  const leverage = position.collateral > 0 ? notional / position.collateral : 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b border-border">
            <th className="px-4 py-2 text-left">Side</th>
            <th className="px-4 py-2 text-right">Size</th>
            <th className="px-4 py-2 text-right">Entry</th>
            <th className="px-4 py-2 text-right">Mark</th>
            <th className="px-4 py-2 text-right">Liq Price</th>
            <th className="px-4 py-2 text-right">uPnL</th>
            <th className="px-4 py-2 text-right">Leverage</th>
            <th className="px-4 py-2 text-right">Collateral</th>
            <th className="px-4 py-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="px-4 py-3">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                position.side === 'long'
                  ? 'bg-emerald-500/20 text-emerald-500'
                  : 'bg-red-500/20 text-red-500'
              }`}>
                {position.side === 'long' ? 'Long' : 'Short'}
              </span>
            </td>
            <td className="px-4 py-3 text-right font-mono">{formatSize(position.size)}</td>
            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatPrice(position.entryPrice)}</td>
            <td className="px-4 py-3 text-right font-mono">{markPrice > 0 ? formatPrice(markPrice) : '—'}</td>
            <td className="px-4 py-3 text-right font-mono text-red-500">
              {liqPrice > 0 ? formatPrice(Math.abs(liqPrice)) : '—'}
            </td>
            <td className={`px-4 py-3 text-right font-mono font-medium ${pnlClass(upnl)}`}>
              {formatPnl(upnl)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{leverage.toFixed(1)}x</td>
            <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatPrice(position.collateral)}</td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => sendClose(position.size)}
                disabled={closing}
                className="px-3 py-1 rounded text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40"
              >
                {closing ? 'Closing…' : 'Close All'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="flex items-center gap-2 px-4 py-2 border-t border-border">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Partial close:</span>
        <input
          type="number"
          min="0"
          step="0.001"
          placeholder={`max ${formatSize(position.size)}`}
          value={closeSize}
          onChange={e => setCloseSize(e.target.value)}
          className="w-36 px-2 py-1 rounded text-xs font-mono bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
        />
        <button
          onClick={() => {
            const parsed = parseFloat(closeSize);
            if (!parsed || parsed <= 0) return;
            sendClose(Math.min(Math.round(parsed * LOT_PRECISION), position.size));
          }}
          disabled={closing || !closeSize || parseFloat(closeSize) <= 0}
          className="px-3 py-1 rounded text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40"
        >
          {closing ? 'Closing…' : 'Close'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 mb-2 text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
