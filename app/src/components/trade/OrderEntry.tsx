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
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4 text-center">
        Connect your wallet to trade
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Order type tabs */}
      <div className="flex rounded-lg overflow-hidden border border-border">
        {(['limit'] as OrderType[]).map(t => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`flex-1 py-1.5 text-sm capitalize transition-colors ${
              orderType === t
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
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
              ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-500'
              : 'border-border text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-500'
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
            side === 'short'
              ? 'bg-red-500/15 border-red-500/50 text-red-500'
              : 'border-border text-muted-foreground hover:border-red-500/40 hover:text-red-500'
          }`}
        >
          Short
        </button>
      </div>

      {/* Price input (limit only) */}
      {orderType === 'limit' && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Limit Price (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
            <input
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              placeholder={(markPrice / PRICE_PRECISION).toFixed(2)}
              className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring font-mono"
            />
          </div>
        </div>
      )}

      {/* Size input */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1.5">Size (USD notional)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
          <input
            type="number"
            value={sizeUsd}
            onChange={e => setSizeUsd(e.target.value)}
            placeholder="0.00"
            className="w-full bg-muted border border-border rounded-lg pl-7 pr-14 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring font-mono"
          />
          <button
            onClick={handleMaxSize}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:text-primary/80 font-medium"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Leverage selector */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Leverage</div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map(l => (
            <button
              key={l}
              onClick={() => setLeverage(l)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                leverage === l
                  ? 'bg-primary/10 border-primary/50 text-primary'
                  : 'bg-muted border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
              }`}
            >
              {l}x
            </button>
          ))}
        </div>
      </div>

      {/* Order summary */}
      <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Required Collateral</span>
          <span className="text-foreground font-mono">
            {requiredCollateral > 0 ? formatUsdc(requiredCollateral) : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Free Margin</span>
          <span className={`font-mono ${requiredCollateral > freeMargin ? 'text-red-500' : 'text-foreground'}`}>
            {formatUsdc(freeMargin)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry Price</span>
          <span className="text-foreground font-mono">
            {effectivePrice > 0 ? `$${(effectivePrice / PRICE_PRECISION).toFixed(2)}` : '—'}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Success */}
      {txSig && (
        <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
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
            ? 'bg-emerald-500 text-white hover:bg-emerald-600'
            : 'bg-red-500 text-white hover:bg-red-600'
        }`}
      >
        {submitting ? 'Placing order…' : `Place ${side === 'long' ? 'Long' : 'Short'}`}
      </button>
    </div>
  );
}
