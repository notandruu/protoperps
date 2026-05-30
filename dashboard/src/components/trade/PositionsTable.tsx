'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { usePrograms } from '@/hooks/usePrograms';
import { PositionData } from '@/hooks/usePosition';
import {
  positionPda,
  marginPda,
  oraclePda,
} from '@/lib/constants';
import {
  formatPrice,
  formatSize,
  formatPnl,
  pnlClass,
  calcUnrealizedPnl,
  calcLiquidationPrice,
} from '@/lib/math';
import { LOT_PRECISION } from '@/lib/constants';
import { MarketData } from '@/hooks/useMarket';

interface PositionsTableProps {
  marketPubkey: PublicKey;
  position: PositionData | null | undefined;
  markPrice: number;
  marketData?: MarketData | null;
  onClose?: () => void;
}

export default function PositionsTable({
  marketPubkey,
  position,
  markPrice,
  marketData,
  onClose,
}: PositionsTableProps) {
  const { publicKey } = useWallet();
  const { program } = usePrograms();
  const [closing, setClosing] = useState(false);
  const [closeSize, setCloseSize] = useState('');
  const [error, setError] = useState('');

  const handleClose = useCallback(async (partial?: number) => {
    if (!publicKey || !program || !position) return;
    setError('');
    setClosing(true);

    try {
      const oracle = oraclePda(marketPubkey);
      const traderMarginPda = marginPda(publicKey);
      const posPda = positionPda(marketPubkey, publicKey);

      const sideParam = position.side === 'long' ? { short: {} } : { long: {} };
      // Use aggressive price to guarantee fill against MM's resting quotes
      const price = new BN(
        position.side === 'long'
          ? Math.round(markPrice * 0.97) // sell 3% below mark
          : Math.round(markPrice * 1.03), // buy 3% above mark
      );
      const rawSize = partial ?? position.size;
      const size = new BN(rawSize);

      // Fetch fresh orderbook so we always have current maker quotes.
      const seen = new Set<string>();
      const makerAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const freshMkt = await (program.account as any).market.fetch(marketPubkey);
        // Zero-copy accounts may come back camelCase or snake_case depending on IDL version.
        const numBids: number = freshMkt.numBids ?? freshMkt.num_bids ?? 0;
        const numAsks: number = freshMkt.numAsks ?? freshMkt.num_asks ?? 0;
        // Closing a long → place short → match against bids.
        // Closing a short → place long → match against asks.
        const rawOrders: Record<string, unknown>[] = position.side === 'long'
          ? (freshMkt.bids as Record<string, unknown>[]).slice(0, numBids)
          : (freshMkt.asks as Record<string, unknown>[]).slice(0, numAsks);

        for (const order of rawOrders) {
          if (makerAccounts.length >= 5) break;
          if (!order.active) continue;
          const traderKey = order.trader instanceof PublicKey
            ? order.trader
            : new PublicKey(order.trader as string);
          const key = traderKey.toBase58();
          if (seen.has(key) || key === publicKey.toBase58()) continue;
          seen.add(key);
          makerAccounts.push({ pubkey: positionPda(marketPubkey, traderKey), isSigner: false, isWritable: true });
        }
      } catch {
        // Fall back to cached data if fetch fails.
        const opposingOrders = position.side === 'long' ? (marketData?.bids ?? []) : (marketData?.asks ?? []);
        for (const order of opposingOrders) {
          if (makerAccounts.length >= 5) break;
          const traderKey = order.trader instanceof PublicKey ? order.trader : new PublicKey(order.trader);
          const key = traderKey.toBase58();
          if (seen.has(key) || key === publicKey.toBase58()) continue;
          seen.add(key);
          makerAccounts.push({ pubkey: positionPda(marketPubkey, traderKey), isSigner: false, isWritable: true });
        }
      }

      if (makerAccounts.length === 0) {
        throw new Error('No liquidity in the book right now — the market maker re-quotes every 30s, please try again in a moment.');
      }

      await program.methods
        .placeOrder({
          side: sideParam,
          orderType: { limit: {} },
          price,
          size,
        })
        .accounts({
          taker: publicKey,
          market: marketPubkey,
          takerPosition: posPda,
          takerMargin: traderMarginPda,
          systemProgram: new PublicKey('11111111111111111111111111111111'),
          oracleFeed: oracle,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .remainingAccounts(makerAccounts)
        .rpc();

      setCloseSize('');
      onClose?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.slice(0, 200));
    } finally {
      setClosing(false);
    }
  }, [publicKey, program, position, markPrice, marketPubkey, marketData, onClose]);

  if (!publicKey) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        Connect wallet to view positions
      </div>
    );
  }

  if (!position || position.size === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        No open position in this market
      </div>
    );
  }

  const upnl = calcUnrealizedPnl(position.entryPrice, markPrice, position.size, position.side);
  const liqPrice = calcLiquidationPrice(
    position.entryPrice,
    position.size,
    position.collateral,
    position.side,
  );

  const notional = (markPrice * position.size) / LOT_PRECISION;
  const leverage = position.collateral > 0 ? notional / position.collateral : 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-text-muted border-b border-border">
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
                  ? 'bg-long/20 text-long'
                  : 'bg-short/20 text-short'
              }`}>
                {position.side === 'long' ? 'Long' : 'Short'}
              </span>
            </td>
            <td className="px-4 py-3 text-right font-mono text-white">
              {formatSize(position.size)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-slate-300">
              {formatPrice(position.entryPrice)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-white">
              {markPrice > 0 ? formatPrice(markPrice) : '—'}
            </td>
            <td className="px-4 py-3 text-right font-mono text-short">
              {liqPrice > 0 ? formatPrice(Math.abs(liqPrice)) : '—'}
            </td>
            <td className={`px-4 py-3 text-right font-mono font-medium ${pnlClass(upnl)}`}>
              {formatPnl(upnl)}
            </td>
            <td className="px-4 py-3 text-right font-mono text-slate-300">
              {leverage.toFixed(1)}x
            </td>
            <td className="px-4 py-3 text-right font-mono text-slate-300">
              {formatPrice(position.collateral)}
            </td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => handleClose()}
                disabled={closing}
                className="px-3 py-1 rounded text-xs font-medium bg-short/10 text-short border border-short/30 hover:bg-short/20 transition-colors disabled:opacity-40"
              >
                {closing ? 'Closing…' : 'Close All'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Partial close row */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border">
        <span className="text-xs text-text-muted whitespace-nowrap">Partial close:</span>
        <input
          type="number"
          min="0"
          step="0.001"
          placeholder={`max ${formatSize(position.size)}`}
          value={closeSize}
          onChange={e => setCloseSize(e.target.value)}
          className="w-36 px-2 py-1 rounded text-xs font-mono bg-surface-2 border border-border text-white placeholder-text-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => {
            const parsed = parseFloat(closeSize);
            if (!parsed || parsed <= 0) return;
            const rawLots = Math.round(parsed * LOT_PRECISION);
            const capped = Math.min(rawLots, position.size);
            handleClose(capped);
          }}
          disabled={closing || !closeSize || parseFloat(closeSize) <= 0}
          className="px-3 py-1 rounded text-xs font-medium bg-short/10 text-short border border-short/30 hover:bg-short/20 transition-colors disabled:opacity-40"
        >
          {closing ? 'Closing…' : 'Close'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 mb-2 text-xs text-short bg-short/10 border border-short/30 rounded px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
