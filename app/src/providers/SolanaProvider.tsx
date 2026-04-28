'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { RPC_URL } from '@/lib/constants';

export default function SolanaProvider({ children }: { children: React.ReactNode }) {
  // Phantom and Backpack implement Wallet Standard and are auto-detected.
  // Only list Solflare explicitly since it uses the legacy adapter.
  const wallets = useMemo(
    () => [new SolflareWalletAdapter()],
    [],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CP = ConnectionProvider as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WP = WalletProvider as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WMP = WalletModalProvider as any;

  return (
    <CP endpoint={RPC_URL}>
      <WP wallets={wallets} autoConnect>
        <WMP>
          {children}
        </WMP>
      </WP>
    </CP>
  );
}
