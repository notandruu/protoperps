'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { usePrograms } from '@/hooks/usePrograms';
import { marginPda } from '@/lib/constants';
import { formatPrice, formatSize } from '@/lib/math';

interface OpenOrder {
  side: 'long' | 'short';
  price: number;
  size: number;
  sequenceNumber: BN;
}

interface OpenOrdersProps {
  marketPubkey: PublicKey;
  onCancel?: () => void;
}

export default function OpenOrders({ marketPubkey, onCancel }: OpenOrdersProps) {
  const { publicKey } = useWallet();
  const { program } = usePrograms();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [orders, setOrders] = useState<OpenOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchOrders = useCallback(async () => {
    if (!publicKey || !program) return;
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mkt = await (program.account as any).market.fetch(marketPubkey);
      const numBids: number = mkt.numBids ?? mkt.num_bids ?? 0;
      const numAsks: number = mkt.numAsks ?? mkt.num_asks ?? 0;
      const rawBids: Record<string, unknown>[] = mkt.bids ?? [];
      const rawAsks: Record<string, unknown>[] = mkt.asks ?? [];
      const myKey = publicKey.toBase58();

      const found: OpenOrder[] = [];

      for (let i = 0; i < numBids; i++) {
        const o = rawBids[i];
        if (!o?.active) continue;
        const trader = o.trader instanceof PublicKey ? o.trader : new PublicKey(o.trader as string);
        if (trader.toBase58() !== myKey) continue;
        found.push({
          side: 'long',
          price: Number(o.price?.toString() ?? 0),
          size: Number(o.size?.toString() ?? 0),
          sequenceNumber: new BN(o.sequenceNumber?.toString() ?? o.sequence_number?.toString() ?? 0),
        });
      }

      for (let i = 0; i < numAsks; i++) {
        const o = rawAsks[i];
        if (!o?.active) continue;
        const trader = o.trader instanceof PublicKey ? o.trader : new PublicKey(o.trader as string);
        if (trader.toBase58() !== myKey) continue;
        found.push({
          side: 'short',
          price: Number(o.price?.toString() ?? 0),
          size: Number(o.size?.toString() ?? 0),
          sequenceNumber: new BN(o.sequenceNumber?.toString() ?? o.sequence_number?.toString() ?? 0),
        });
      }

      setOrders(found);
    } catch (e) {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [publicKey, program, marketPubkey]);

  const handleCancel = useCallback(async (order: OpenOrder) => {
    if (!publicKey || !program) return;
    const key = `${order.side}-${order.sequenceNumber.toString()}`;
    setCancelling(key);
    setError('');
    try {
      const traderMarginPda = marginPda(publicKey);
      await program.methods
        .cancelOrder({
          side: order.side === 'long' ? { long: {} } : { short: {} },
          sequenceNumber: order.sequenceNumber,
        })
        .accounts({
          trader: publicKey,
          market: marketPubkey,
          traderMargin: traderMarginPda,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .rpc();
      await fetchOrders();
      onCancel?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.slice(0, 200));
    } finally {
      setCancelling(null);
    }
  }, [publicKey, program, marketPubkey, fetchOrders, onCancel]);

  if (!publicKey) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        Connect wallet to view open orders
      </div>
    );
  }

  if (orders === null) {
    return (
      <div className="flex items-center justify-center py-6">
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="px-4 py-1.5 rounded text-xs font-medium bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Load Open Orders'}
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        No resting orders
        <button onClick={fetchOrders} className="ml-2 text-xs text-accent hover:underline">refresh</button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs text-text-muted">{orders.length} resting order{orders.length > 1 ? 's' : ''}</span>
        <button onClick={fetchOrders} disabled={loading} className="text-xs text-accent hover:underline disabled:opacity-40">
          {loading ? 'refreshing…' : 'refresh'}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-text-muted border-b border-border">
            <th className="px-4 py-2 text-left">Side</th>
            <th className="px-4 py-2 text-right">Size</th>
            <th className="px-4 py-2 text-right">Limit Price</th>
            <th className="px-4 py-2 text-right">Seq#</th>
            <th className="px-4 py-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => {
            const key = `${o.side}-${o.sequenceNumber.toString()}`;
            return (
              <tr key={key} className="border-b border-border">
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    o.side === 'long' ? 'bg-long/20 text-long' : 'bg-short/20 text-short'
                  }`}>
                    {o.side === 'long' ? 'Long' : 'Short'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-white">{formatSize(o.size)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{formatPrice(o.price)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-400 text-xs">{o.sequenceNumber.toString()}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleCancel(o)}
                    disabled={cancelling === key}
                    className="px-3 py-1 rounded text-xs font-medium bg-muted/40 text-muted-foreground border border-border hover:bg-muted/70 transition-colors disabled:opacity-40"
                  >
                    {cancelling === key ? 'Cancelling…' : 'Cancel'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <div className="mx-4 mt-2 mb-2 text-xs text-short bg-short/10 border border-short/30 rounded px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
