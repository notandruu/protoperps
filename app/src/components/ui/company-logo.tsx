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
  SPACEX: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  OPENAI: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  ANTHRP: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  ANDURL: 'bg-red-500/15 text-red-400 border-red-500/20',
  POLMKT: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  NRLNK:  'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  KALSHI: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
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
