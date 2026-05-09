'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Button } from '@/components/ui/button';
import { Droplets } from 'lucide-react';

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
        setMsg(`${data.amount?.toLocaleString()} USDC sent to your wallet`);
      }
    } catch {
      setStatus('error');
      setMsg('Network error');
    }
  }

  if (!publicKey) return null;

  return (
    <div className="relative rounded-lg p-[1px] bg-border">
      <div
        className="absolute inset-0 rounded-lg bg-gradient-to-bl from-blue-500 via-blue-500/20 to-transparent opacity-80"
        style={{
          maskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
        }}
      />
      <div className="relative rounded-lg bg-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Droplets className="h-4 w-4 text-blue-500" />
          <h2 className="text-sm font-semibold text-foreground">Devnet Faucet</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Get 1,000 test USDC. One drip per wallet per 24 hours.
        </p>
        <Button
          onClick={drip}
          disabled={status === 'loading'}
          className="w-full"
        >
          {status === 'loading' ? 'Sending…' : 'Get 1,000 USDC'}
        </Button>
        {msg && (
          <p className={`mt-3 text-xs text-center ${status === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
