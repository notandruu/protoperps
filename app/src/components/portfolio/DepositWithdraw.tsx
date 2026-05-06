'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { usePrograms } from '@/hooks/usePrograms';
import { USDC_MINT, marginPda, vaultAuthorityPda } from '@/lib/constants';
import { PRICE_PRECISION } from '@/lib/constants';

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
    setError('');
    setTxSig('');
    setSubmitting(true);

    try {
      const rawAmount = new BN(Math.round(parseFloat(amount) * PRICE_PRECISION));
      if (rawAmount.isZero() || rawAmount.isNeg()) throw new Error('Amount must be positive');

      const marginAccountPda = marginPda(publicKey);
      const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const vaultAuth = vaultAuthorityPda();
      const vault = getAssociatedTokenAddressSync(USDC_MINT, vaultAuth, true);

      // Create the user's USDC ATA if it doesn't exist yet
      const preInstructions = [];
      const ataInfo = await connection.getAccountInfo(userUsdc);
      if (!ataInfo) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            publicKey,
            userUsdc,
            publicKey,
            USDC_MINT,
          ),
        );
      }

      let sig: string;
      if (tab === 'deposit') {
        sig = await program.methods
          .depositCollateral(rawAmount)
          .accounts({
            owner: publicKey,
            marginAccount: marginAccountPda,
            userUsdc,
            vaultAuthority: vaultAuth,
            vault,
            usdcMint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SYSTEM_PROGRAM_ID,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .preInstructions(preInstructions)
          .rpc();
      } else {
        sig = await program.methods
          .withdrawCollateral(rawAmount)
          .accounts({
            owner: publicKey,
            marginAccount: marginAccountPda,
            userUsdc,
            vaultAuthority: vaultAuth,
            vault,
            usdcMint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SYSTEM_PROGRAM_ID,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .rpc();
      }

      setTxSig(sig);
      setAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.slice(0, 200));
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, program, tab, amount]);

  if (!publicKey) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="text-center text-text-muted text-sm py-4">
          Connect wallet to deposit or withdraw
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
        {tab === 'deposit' ? 'Deposit' : 'Withdraw'} USDC
      </h2>

      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden border border-border mb-4">
        {(['deposit', 'withdraw'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setError(''); setTxSig(''); }}
            className={`flex-1 py-2 text-sm capitalize transition-colors ${
              tab === t
                ? 'bg-surface-2 text-white'
                : 'text-text-muted hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="block text-xs text-text-muted mb-1">Amount (USDC)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full bg-surface-2 border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-white placeholder-text-muted focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 text-xs text-short bg-short/10 border border-short/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Success */}
      {txSig && (
        <div className="mb-3 text-xs text-long bg-long/10 border border-long/30 rounded-lg px-3 py-2">
          Success!{' '}
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View tx
          </a>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !amount || parseFloat(amount) <= 0}
        className="w-full py-2.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting
          ? (tab === 'deposit' ? 'Depositing…' : 'Withdrawing…')
          : (tab === 'deposit' ? 'Deposit' : 'Withdraw')
        }
      </button>

      <p className="mt-3 text-xs text-text-muted text-center">
        USDC on devnet. Make sure your wallet has devnet USDC.
      </p>
    </div>
  );
}
