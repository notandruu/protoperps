'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, AccountMeta } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { usePrograms } from '@/hooks/usePrograms';
import { useMarginAccount } from '@/hooks/useMarginAccount';
import { MarketData } from '@/hooks/useMarket';
import {
  PROTOPERPS_PROGRAM_ID,
  USDC_MINT,
  positionPda,
  marginPda,
  vaultAuthorityPda,
} from '@/lib/constants';
import { PRICE_PRECISION, LOT_PRECISION } from '@/lib/constants';
import { formatUsdc } from '@/lib/math';

interface OrderEntryProps {
  marketPubkey: PublicKey;
  marketData: MarketData | null | undefined;
  markPrice: number;
}

type OrderType = 'market' | 'limit';
type Side = 'long' | 'short';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export default function OrderEntry({ marketPubkey, marketData, markPrice }: OrderEntryProps) {
  const { publicKey } = useWallet();
  const { program } = usePrograms();
  const { data: margin } = useMarginAccount();

  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [side, setSide] = useState<Side>('long');
  const [limitPrice, setLimitPrice] = useState('');
  const [sizeUsd, setSizeUsd] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [txSig, setTxSig] = useState('');

  const freeMargin = margin?.free ?? 0;

  const effectivePrice = orderType === 'market'
    ? (side === 'long' ? Math.round(markPrice * 1.01) : Math.round(markPrice * 0.99))
    : Math.round(parseFloat(limitPrice || '0') * PRICE_PRECISION);

  const rawSize = sizeUsd
    ? Math.round((parseFloat(sizeUsd) * leverage * LOT_PRECISION * PRICE_PRECISION) / (effectivePrice || 1))
    : 0;

  const requiredCollateral = rawSize > 0 && effectivePrice > 0
    ? Math.round((effectivePrice * rawSize) / LOT_PRECISION / leverage)
    : 0;

  const handleMaxSize = useCallback(() => {
    if (freeMargin <= 0 || effectivePrice <= 0) return;
    const maxUsd = (freeMargin * leverage) / PRICE_PRECISION;
    setSizeUsd(maxUsd.toFixed(2));
  }, [freeMargin, leverage, effectivePrice]);

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !program) return;
    setError('');
    setTxSig('');
    setSubmitting(true);

    try {
      const price = new BN(effectivePrice);
      const size = new BN(rawSize);

      if (price.isZero() || size.isZero()) {
        throw new Error('Price and size must be greater than 0');
      }
      if (requiredCollateral > freeMargin) {
        throw new Error(`Insufficient free margin. Need ${formatUsdc(requiredCollateral)}`);
      }

      const takerPositionPda = positionPda(marketPubkey, publicKey);
      const takerMarginPda = marginPda(publicKey);
      const oracleKey = (await import('@/lib/constants')).oraclePda(marketPubkey);

      // Determine order type enum
      const orderTypeParam = orderType === 'limit'
        ? { limit: {} }
        : { market: {} };
      const sideParam = side === 'long' ? { long: {} } : { short: {} };

      // Gather maker position PDAs for resting orders that this order might fill
      const remainingAccounts: AccountMeta[] = [];
      if (marketData) {
        const oppositeOrders = side === 'long'
          ? marketData.asks.filter(o => o.price <= effectivePrice)
          : marketData.bids.filter(o => o.price >= effectivePrice);

        for (const order of oppositeOrders.slice(0, 5)) {
          const makerPositionPda = positionPda(marketPubkey, order.trader);
          remainingAccounts.push({ pubkey: makerPositionPda, isWritable: true, isSigner: false });
        }
      }

      const sig = await program.methods
        .placeOrder({
          side: sideParam,
          orderType: orderTypeParam,
          price,
          size,
        })
        .accounts({
          taker: publicKey,
          market: marketPubkey,
          takerPosition: takerPositionPda,
          takerMargin: takerMarginPda,
          systemProgram: new PublicKey('11111111111111111111111111111111'),
          oracleFeed: oracleKey,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .remainingAccounts(remainingAccounts)
        .rpc();

      setTxSig(sig);
      setSizeUsd('');
      setLimitPrice('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('0x') ? msg.split('0x')[0].trim() : msg);
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, program, effectivePrice, rawSize, requiredCollateral, freeMargin, orderType, side, marketPubkey, marketData]);

  if (!publicKey) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm p-4 text-center">
        Connect your wallet to trade
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
                ? 'bg-surface-2 text-white'
                : 'text-text-muted hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Side buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setSide('long')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
            side === 'long'
              ? 'bg-long/20 border-long text-long'
              : 'border-border text-text-muted hover:border-long hover:text-long'
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
            side === 'short'
              ? 'bg-short/20 border-short text-short'
              : 'border-border text-text-muted hover:border-short hover:text-short'
          }`}
        >
          Short
        </button>
      </div>

      {/* Price input (limit only) */}
      {orderType === 'limit' && (
        <div>
          <label className="block text-xs text-text-muted mb-1">Limit Price (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
            <input
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              placeholder={(markPrice / PRICE_PRECISION).toFixed(2)}
              className="w-full bg-surface-2 border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-white placeholder-text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {/* Size input */}
      <div>
        <label className="block text-xs text-text-muted mb-1">Size (USD notional)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
          <input
            type="number"
            value={sizeUsd}
            onChange={e => setSizeUsd(e.target.value)}
            placeholder="0.00"
            className="w-full bg-surface-2 border border-border rounded-lg pl-7 pr-14 py-2 text-sm text-white placeholder-text-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleMaxSize}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent hover:text-purple-400"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Leverage slider */}
      <div>
        <div className="flex justify-between text-xs text-text-muted mb-1">
          <span>Leverage</span>
          <span className="text-white font-medium">{leverage}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={leverage}
          onChange={e => setLeverage(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-xs text-text-muted mt-0.5">
          {[1, 2, 3, 4, 5].map(l => (
            <span key={l} className={leverage === l ? 'text-accent' : ''}>{l}x</span>
          ))}
        </div>
      </div>

      {/* Order summary */}
      <div className="rounded-lg bg-surface-2 border border-border p-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Required Collateral</span>
          <span className="text-white font-mono">
            {requiredCollateral > 0 ? formatUsdc(requiredCollateral) : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Free Margin</span>
          <span className={`font-mono ${requiredCollateral > freeMargin ? 'text-short' : 'text-white'}`}>
            {formatUsdc(freeMargin)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Entry Price</span>
          <span className="text-white font-mono">
            {effectivePrice > 0 ? `$${(effectivePrice / PRICE_PRECISION).toFixed(2)}` : '—'}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-short bg-short/10 border border-short/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Success */}
      {txSig && (
        <div className="text-xs text-long bg-long/10 border border-long/30 rounded-lg px-3 py-2">
          Order placed!{' '}
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

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || !sizeUsd || parseFloat(sizeUsd) <= 0 || (orderType === 'limit' && !limitPrice)}
        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          side === 'long'
            ? 'bg-long text-white hover:bg-green-600'
            : 'bg-short text-white hover:bg-red-600'
        }`}
      >
        {submitting ? 'Placing order…' : `Place ${side === 'long' ? 'Long' : 'Short'}`}
      </button>
    </div>
  );
}
