'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { usePrograms } from '@/hooks/usePrograms';
import { USDC_MINT, marginPda, vaultAuthorityPda, PRICE_PRECISION } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

type Tab = 'deposit' | 'withdraw';

export default function DepositWithdraw() {
  const { publicKey } = useWallet();
  const { program, connection } = usePrograms();
  const [tab, setTab] = useState<Tab>('deposit');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [txSig, setTxSig] = useState('');

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !program || !amount) return;
    setError(''); setTxSig(''); setSubmitting(true);
    try {
      const rawAmount = new BN(Math.round(parseFloat(amount) * PRICE_PRECISION));
      if (rawAmount.isZero() || rawAmount.isNeg()) throw new Error('Amount must be positive');

      const marginAccountPda = marginPda(publicKey);
      const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const vaultAuth = vaultAuthorityPda();
      const vault = getAssociatedTokenAddressSync(USDC_MINT, vaultAuth, true);

      const preInstructions = [];
      const ataInfo = await connection.getAccountInfo(userUsdc);
      if (!ataInfo) {
        preInstructions.push(createAssociatedTokenAccountInstruction(publicKey, userUsdc, publicKey, USDC_MINT));
      }

      let sig: string;
      if (tab === 'deposit') {
        sig = await program.methods.depositCollateral(rawAmount)
          .accounts({ owner: publicKey, marginAccount: marginAccountPda, userUsdc, vaultAuthority: vaultAuth, vault, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SYSTEM_PROGRAM_ID } as any)
          .preInstructions(preInstructions).rpc();
      } else {
        sig = await program.methods.withdrawCollateral(rawAmount)
          .accounts({ owner: publicKey, marginAccount: marginAccountPda, userUsdc, vaultAuthority: vaultAuth, vault, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SYSTEM_PROGRAM_ID } as any)
          .rpc();
      }
      setTxSig(sig); setAmount('');
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).slice(0, 200));
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, program, tab, amount, connection]);

  if (!publicKey) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-center text-muted-foreground text-sm py-8">
        Connect wallet to deposit or withdraw
      </div>
    );
  }

  return (
    <div className="relative rounded-lg p-[1px] bg-border">
      <div
        className="absolute inset-0 rounded-lg bg-gradient-to-bl from-violet-500 via-violet-500/20 to-transparent opacity-80"
        style={{
          maskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 50%)',
        }}
      />
      <div className="relative rounded-lg bg-card p-5">

        {/* Tabs */}
        <div className="flex rounded-lg overflow-hidden border border-border mb-5">
          {(['deposit', 'withdraw'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); setTxSig(''); }}
              className={cn(
                'flex-1 py-2 text-sm capitalize transition-colors flex items-center justify-center gap-1.5',
                tab === t ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'deposit'
                ? <ArrowDownToLine className="h-3.5 w-3.5" />
                : <ArrowUpFromLine className="h-3.5 w-3.5" />}
              {t}
            </button>
          ))}
        </div>

        {/* Amount input */}
        <div className="mb-4">
          <label className="block text-xs text-muted-foreground mb-1.5">Amount (USDC)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring font-mono"
            />
          </div>
        </div>

        {error && (
          <div className="mb-3 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {txSig && (
          <div className="mb-3 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            Success!{' '}
            <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="underline">
              View tx →
            </a>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={submitting || !amount || parseFloat(amount) <= 0}
          className="w-full"
        >
          {submitting
            ? (tab === 'deposit' ? 'Depositing…' : 'Withdrawing…')
            : (tab === 'deposit' ? 'Deposit USDC' : 'Withdraw USDC')}
        </Button>

        <p className="mt-3 text-xs text-muted-foreground text-center">
          Devnet USDC only — use the faucet above to get test funds.
        </p>
      </div>
    </div>
  );
}
