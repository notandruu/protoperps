'use client';

import useSWR from 'swr';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePrograms } from './usePrograms';
import { marginPda } from '@/lib/constants';

export interface MarginAccountData {
  owner: string;
  usdcDeposited: number;
  usdcLocked: number;
  free: number;
}

export function useMarginAccount() {
  const { publicKey } = useWallet();
  const { program } = usePrograms();

  return useSWR<MarginAccountData | null>(
    program && publicKey ? ['margin', publicKey.toBase58()] : null,
    async () => {
      try {
        const pda = marginPda(publicKey!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const margin = await (program!.account as any).marginAccount.fetch(pda);
        const deposited = Number(margin.usdcDeposited?.toString() ?? margin.usdc_deposited?.toString() ?? 0);
        const locked = Number(margin.usdcLocked?.toString() ?? margin.usdc_locked?.toString() ?? 0);
        return {
          owner: publicKey!.toBase58(),
          usdcDeposited: deposited,
          usdcLocked: locked,
          free: deposited - locked,
        };
      } catch {
        return null;
      }
    },
    { refreshInterval: 5000 },
  );
}
