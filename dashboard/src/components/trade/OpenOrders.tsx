'use client';

import { useState } from 'react';
import { useTrader } from '@/hooks/useTrader';
import { API_URL } from '@/lib/constants';

interface OpenOrdersProps {
  symbol: string;
  onCancel?: () => void;
}

export default function OpenOrders({ symbol, onCancel }: OpenOrdersProps) {
  const { traderId } = useTrader();
  const [seqNum, setSeqNum] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleCancel = async () => {
    const seq = parseInt(seqNum, 10);
    if (!traderId || isNaN(seq) || seq <= 0) return;
    setError('');
    setSuccess('');
    setCancelling(true);
    try {
      const params = new URLSearchParams({ trader: traderId, market: symbol });
      const res = await fetch(`${API_URL}/orders/${seq}?${params}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail ?? `HTTP ${res.status}`);
      }
      setSuccess(`Cancel accepted for seq #${seq}`);
      setSeqNum('');
      onCancel?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  if (!traderId) {
    return (
      <div className="text-center text-muted-foreground text-sm py-6">
        Set a trader ID to cancel orders
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        The order book does not expose per-trader resting orders over REST. Cancel a specific
        order by entering its sequence number below (visible in fill confirmations).
      </p>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min="1"
          step="1"
          placeholder="sequence number"
          value={seqNum}
          onChange={e => setSeqNum(e.target.value)}
          className="w-44 px-3 py-1.5 rounded-lg text-xs font-mono bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
        />
        <button
          onClick={handleCancel}
          disabled={cancelling || !seqNum || parseInt(seqNum, 10) <= 0}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-ring transition-colors disabled:opacity-40"
        >
          {cancelling ? 'Cancelling…' : 'Cancel Order'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}
      {success && (
        <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{success}</div>
      )}
    </div>
  );
}
