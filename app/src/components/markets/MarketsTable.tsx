'use client';

import { useRouter } from 'next/navigation';
import { MARKETS } from '@/lib/constants';
import { useOracle, effectiveOracleStatus } from '@/hooks/useOracle';
import { useMarket } from '@/hooks/useMarket';
import { formatPrice, formatUsdc, formatFundingRate } from '@/lib/math';
import { PRICE_PRECISION, LOT_PRECISION } from '@/lib/constants';

function MarketRow({ symbol, name, marketPubkey }: { symbol: string; name: string; marketPubkey: import('@solana/web3.js').PublicKey }) {
  const router = useRouter();
  const { data: oracle } = useOracle(marketPubkey);
  const { data: market } = useMarket(marketPubkey);
  const status = effectiveOracleStatus(oracle);

  const price = oracle?.price ?? 0;
  const openInterest = market?.openInterest ?? 0;
  const fundingRate = market?.cumulativeFundingRate ?? 0;

  const statusLabel = status === 0 ? 'Active' : status === 1 ? 'Reduce Only' : 'Paused';
  const statusClass = status === 0 ? 'text-long' : status === 1 ? 'text-yellow-400' : 'text-short';

  return (
    <tr className="border-b border-border hover:bg-surface-2 transition-colors">
      {/* Asset */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-xs font-bold text-slate-400">
            {symbol.slice(0, 2)}
          </div>
          <div>
            <div className="text-sm font-medium text-white">{name}</div>
            <div className="text-xs text-text-muted">{symbol}-PERP</div>
          </div>
        </div>
      </td>

      {/* Mark Price */}
      <td className="px-4 py-3 text-sm font-mono text-white">
        {price > 0 ? formatPrice(price) : <span className="text-text-muted">—</span>}
      </td>

      {/* Funding Rate */}
      <td className="px-4 py-3 text-sm font-mono">
        <span className={fundingRate >= 0 ? 'text-long' : 'text-short'}>
          {formatFundingRate(fundingRate)}
        </span>
      </td>

      {/* Open Interest */}
      <td className="px-4 py-3 text-sm font-mono text-slate-300">
        {openInterest > 0
          ? formatUsdc(Math.round((openInterest / LOT_PRECISION) * (price / PRICE_PRECISION) * PRICE_PRECISION))
          : <span className="text-text-muted">—</span>
        }
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${statusClass}`}>{statusLabel}</span>
      </td>

      {/* Action */}
      <td className="px-4 py-3">
        <button
          onClick={() => router.push(`/trade/${symbol}`)}
          disabled={status === 2}
          className="px-3 py-1 rounded text-xs font-medium bg-accent text-white hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Trade
        </button>
      </td>
    </tr>
  );
}

export default function MarketsTable() {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-surface border-b border-border">
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Asset</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Mark Price</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Funding Rate</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Open Interest</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface/50">
          {MARKETS.map(m => (
            <MarketRow
              key={m.symbol}
              symbol={m.symbol}
              name={m.name}
              marketPubkey={m.marketPubkey}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
