'use client';

import useSWR from 'swr';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePrograms } from './usePrograms';
import { positionPda } from '@/lib/constants';

export interface PositionData {
  pubkey: PublicKey;
  market: PublicKey;
  trader: PublicKey;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  collateral: number;
  realizedPnl: number;
  lastFundingRate: number;
}

export function usePosition(marketPubkey: PublicKey | null) {
  const { publicKey } = useWallet();
  const { program } = usePrograms();

  return useSWR<PositionData | null>(
    program && marketPubkey && publicKey
      ? ['position', marketPubkey.toBase58(), publicKey.toBase58()]
      : null,
    async () => {
      try {
        const pda = positionPda(marketPubkey!, publicKey!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pos = await (program!.account as any).position.fetch(pda);
        const side: 'long' | 'short' = pos.side?.long !== undefined ? 'long' : 'short';
        return {
          pubkey: pda,
          market: pos.market as PublicKey,
          trader: pos.trader as PublicKey,
          side,
          size: Number(pos.size?.toString() ?? 0),
          entryPrice: Number(pos.entryPrice?.toString() ?? pos.entry_price?.toString() ?? 0),
          collateral: Number(pos.collateral?.toString() ?? 0),
          realizedPnl: Number(pos.realizedPnl?.toString() ?? pos.realized_pnl?.toString() ?? 0),
          lastFundingRate: Number(pos.lastFundingRate?.toString() ?? pos.last_funding_rate?.toString() ?? 0),
        };
      } catch {
        return null;
      }
    },
    { refreshInterval: 5000 },
  );
}

/** Fetch all positions across all markets for the connected wallet. */
export function useAllPositions() {
  const { publicKey } = useWallet();
  const { program } = usePrograms();

  return useSWR<PositionData[]>(
    program && publicKey ? ['all-positions', publicKey.toBase58()] : null,
    async () => {
      try {
        const filters = [
          {
            memcmp: {
              offset: 41, // trader pubkey at offset 41: 8 (discriminator) + 1 (bump) + 32 (market)
              bytes: publicKey!.toBase58(),
            },
          },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const accounts = await (program!.account as any).position.all(filters);
        return accounts
          .map(({ publicKey: pk, account }: { publicKey: PublicKey; account: Record<string, unknown> }) => {
            const size = Number(account.size?.toString() ?? 0);
            if (size === 0) return null;
            const side: 'long' | 'short' =
              (account.side as Record<string, unknown>)?.long !== undefined ? 'long' : 'short';
            return {
              pubkey: pk,
              market: account.market as PublicKey,
              trader: account.trader as PublicKey,
              side,
              size,
              entryPrice: Number(account.entryPrice?.toString() ?? account.entry_price?.toString() ?? 0),
              collateral: Number(account.collateral?.toString() ?? 0),
              realizedPnl: Number(account.realizedPnl?.toString() ?? account.realized_pnl?.toString() ?? 0),
              lastFundingRate: Number(account.lastFundingRate?.toString() ?? account.last_funding_rate?.toString() ?? 0),
            } as PositionData;
          })
          .filter(Boolean) as PositionData[];
      } catch {
        return [];
      }
    },
    { refreshInterval: 5000 },
  );
}
