'use client';

import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';

export default function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (connecting) {
    return (
      <button className="px-4 py-2 rounded-lg bg-accent text-white text-sm opacity-60 cursor-not-allowed">
        Connecting…
      </button>
    );
  }

  if (publicKey) {
    const addr = publicKey.toBase58();
    const short = addr.slice(0, 4) + '…' + addr.slice(-4);
    return (
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 rounded-lg bg-surface-2 border border-border text-sm text-slate-300 hover:border-accent hover:text-white transition-colors"
      >
        {short}
      </button>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-purple-700 transition-colors"
    >
      Connect Wallet
    </button>
  );
}
