'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import WalletButton from './WalletButton';
import { Button } from '@/components/ui/button';

const NAV_LINKS = [
  { href: '/', label: 'Markets' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/faq', label: 'FAQ' },
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
      <div className="px-5 py-3 grid grid-cols-3 items-center">

        {/* Logo — left */}
        <Link href="/" className="select-none flex items-center gap-2 justify-self-start">
          <Image src="/logo.png" alt="ProtoPerps" width={26} height={26} />
          <span className="text-[1.05rem] font-bold tracking-tight leading-none">
            <span className="text-foreground">Proto</span><span className="text-muted-foreground font-medium">Perps</span>
          </span>
        </Link>

        {/* Nav links — truly centered */}
        <nav className="flex items-center gap-1 justify-self-center">
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
        <div className="flex items-center gap-4 justify-self-end">
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
