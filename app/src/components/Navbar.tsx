'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import WalletButton from './WalletButton';
import { Button } from '@/components/ui/button';

const NAV_LINKS = [
  { href: '/', label: 'Markets' },
  { href: '/portfolio', label: 'Portfolio' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setDateStr(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
      setTimeStr(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-50 rounded-b-xl border border-t-0 border-border bg-card/90 backdrop-blur-md">
      <div className="px-5 py-3 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="select-none">
          <span className="text-[1.05rem] font-semibold tracking-tight leading-none">
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">proto</span><span className="text-foreground">perps</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <Link key={href} href={href}>
                <Button
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  className="text-sm"
                >
                  {label}
                </Button>
              </Link>
            );
          })}
        </nav>

        {/* Right: clock + wallet */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end text-sm font-mono">
            <span className="text-muted-foreground text-xs">{dateStr}</span>
            <span className="text-foreground tabular-nums">{timeStr}</span>
          </div>
          <WalletButton />
        </div>

      </div>
    </header>
  );
}
