'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const SYMBOL_TO_DOMAIN: Record<string, string> = {
  SPACEX: 'spacex.com',
  OPENAI: 'openai.com',
  ANTHRP: 'anthropic.com',
  ANDURL: 'anduril.com',
  POLMKT: 'polymarket.com',
  NRLNK:  'neuralink.com',
  KALSHI: 'kalshi.com',
};

const SYMBOL_TO_INITIALS: Record<string, string> = {
  SPACEX: 'SX',
  OPENAI: 'OA',
  ANTHRP: 'AN',
  ANDURL: 'AD',
  POLMKT: 'PM',
  NRLNK:  'NL',
  KALSHI: 'KA',
};

const SYMBOL_TO_ACCENT: Record<string, string> = {
  SPACEX: 'bg-[#005288]/15 text-[#4d9ec4] border-[#005288]/25',
  OPENAI: 'bg-[#10a37f]/15 text-[#10a37f] border-[#10a37f]/25',
  ANTHRP: 'bg-[#c96442]/15 text-[#c96442] border-[#c96442]/25',
  ANDURL: 'bg-[#f04e23]/15 text-[#f04e23] border-[#f04e23]/25',
  POLMKT: 'bg-[#6031b6]/15 text-[#9b6ddb] border-[#6031b6]/25',
  NRLNK:  'bg-[#00c7e6]/15 text-[#00c7e6] border-[#00c7e6]/25',
  KALSHI: 'bg-[#05c168]/15 text-[#05c168] border-[#05c168]/25',
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
