'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const SYMBOL_TO_DOMAIN: Record<string, string> = {
  BTCUSDT: 'bitcoin.org',
  ETHUSDT: 'ethereum.org',
  SOLUSDT: 'solana.com',
};

const SYMBOL_TO_INITIALS: Record<string, string> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
  SOLUSDT: 'SOL',
};

const SYMBOL_TO_ACCENT: Record<string, string> = {
  BTCUSDT: 'bg-[#f7931a]/15 text-[#f7931a] border-[#f7931a]/25',
  ETHUSDT: 'bg-[#627eea]/15 text-[#627eea] border-[#627eea]/25',
  SOLUSDT: 'bg-[#9945ff]/15 text-[#9945ff] border-[#9945ff]/25',
};

interface CompanyLogoProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function CompanyLogo({ symbol, size = 32, className }: CompanyLogoProps) {
  const domain = SYMBOL_TO_DOMAIN[symbol];
  const initials = SYMBOL_TO_INITIALS[symbol] ?? symbol.slice(0, 2);
  const accent = SYMBOL_TO_ACCENT[symbol] ?? 'bg-muted text-muted-foreground border-border';

  const [src, setSrc] = useState(
    domain ? `https://logo.clearbit.com/${domain}` : null
  );
  const [failed, setFailed] = useState(false);

  const wrapperStyle = { width: size, height: size };
  const fontSize = size <= 24 ? 'text-[9px]' : size <= 32 ? 'text-[10px]' : 'text-xs';

  if (!src || failed) {
    return (
      <div
        style={wrapperStyle}
        className={cn(
          'rounded-md border flex items-center justify-center font-bold shrink-0',
          fontSize,
          accent,
          className,
        )}
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      style={wrapperStyle}
      className={cn('rounded-md overflow-hidden shrink-0 border border-border flex items-center justify-center', className)}
    >
      <Image
        src={src}
        alt={symbol}
        width={size}
        height={size}
        className="object-cover w-full h-full"
        onError={() => {
          if (src.includes('clearbit')) {
            setSrc(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);
          } else {
            setFailed(true);
          }
        }}
        unoptimized
      />
    </div>
  );
}
