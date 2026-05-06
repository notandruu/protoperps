'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function FaucetButton() {
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState('');

  async function drip() {
    if (!publicKey) return;
    setStatus('loading');
    setMsg('');
    try {
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const data = (await res.json()) as { amount?: number; sig?: string; error?: string };
      if (!res.ok) {
        setStatus('error');
        setMsg(data.error ?? 'Faucet failed');
      } else {
        setStatus('success');
        setMsg(`${data.amount?.toLocaleString()} USDC sent`);
      }
    } catch {
      setStatus('error');
      setMsg('Network error');
    }
  }

  if (!publicKey) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
        Devnet Faucet
      </h2>
      <p className="text-sm text-text-muted mb-4">
        Get 1,000 test USDC to try the demo. One drip per wallet per 24 hours.
      </p>
      <button
        onClick={drip}
        disabled={status === 'loading'}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {status === 'loading' ? 'Sending…' : 'Get 1,000 USDC'}
      </button>
      {msg && (
        <p className={`mt-3 text-sm text-center ${status === 'success' ? 'text-long' : 'text-short'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
