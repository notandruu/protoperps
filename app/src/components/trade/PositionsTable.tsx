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
  PROTOPERPS_PROGRAM_ID,
} from '@/lib/constants';
import {
  formatPrice,
  formatSize,
  formatPnl,
  pnlClass,
  calcUnrealizedPnl,
  calcLiquidationPrice,
} from '@/lib/math';
import { PRICE_PRECISION, LOT_PRECISION } from '@/lib/constants';

interface PositionsTableProps {
  marketPubkey: PublicKey;
  position: PositionData | null | undefined;
  markPrice: number;
  onClose?: () => void;
}

export default function PositionsTable({
  marketPubkey,
  position,
  markPrice,
  onClose,
}: PositionsTableProps) {
  const { publicKey } = useWallet();
  const { program } = usePrograms();
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');

  const handleClose = useCallback(async () => {
    if (!publicKey || !program || !position) return;
    setError('');
    setClosing(true);

    try {
      const oracle = oraclePda(marketPubkey);
      const traderMarginPda = marginPda(publicKey);
      const posPda = positionPda(marketPubkey, publicKey);

      // Close position by placing a market order on the opposite side
      const sideParam = position.side === 'long' ? { short: {} } : { long: {} };
      const price = new BN(
        position.side === 'long'
          ? Math.round(markPrice * 0.99) // sell below mark
          : Math.round(markPrice * 1.01), // buy above mark
      );
      const size = new BN(position.size);

      await program.methods
        .placeOrder({
          side: sideParam,
          orderType: { market: {} },
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
        .rpc();

      onClose?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.slice(0, 120));
    } finally {
      setClosing(false);
    }
  }, [publicKey, program, position, markPrice, marketPubkey, onClose]);

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
                onClick={handleClose}
                disabled={closing}
                className="px-3 py-1 rounded text-xs font-medium bg-short/10 text-short border border-short/30 hover:bg-short/20 transition-colors disabled:opacity-40"
              >
                {closing ? 'Closing…' : 'Close'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {error && (
        <div className="mx-4 mt-2 text-xs text-short bg-short/10 border border-short/30 rounded px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
