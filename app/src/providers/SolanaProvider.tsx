'use client';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { RPC_URL } from '@/lib/constants';

export default function SolanaProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
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
