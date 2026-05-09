'use client';

import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { Button } from '@/components/ui/button';

export default function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (connecting) {
    return <Button variant="secondary" size="sm" disabled>Connecting…</Button>;
  }

  if (publicKey) {
    const addr = publicKey.toBase58();
    const short = addr.slice(0, 4) + '…' + addr.slice(-4);
    return (
      <Button variant="outline" size="sm" className="font-mono" onClick={() => disconnect()}>
        {short}
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={() => setVisible(true)}>
      Connect Wallet
    </Button>
  );
}
