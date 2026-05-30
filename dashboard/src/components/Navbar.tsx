'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useTrader } from '@/hooks/useTrader';
import { Button } from '@/components/ui/button';
import { User, Check } from 'lucide-react';

const NAV_LINKS = [
  { href: '/',          label: 'Markets'   },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/faq',       label: 'FAQ'       },
];

export default function Navbar() {
  const pathname = usePathname();
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const { traderId, setTraderId } = useTrader();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  const openEdit = () => {
    setDraft(traderId);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    setTraderId(draft);
    setEditing(false);
  };

  return (
    <header className="sticky top-0 z-50 rounded-b-xl border border-t-0 border-border bg-card/90 backdrop-blur-md">
      <div className="px-5 py-3 grid grid-cols-3 items-center">

        {/* Logo */}
        <Link href="/" className="select-none flex items-center gap-2 justify-self-start">
          <Image src="/logo.png" alt="Trading Engine" width={26} height={26} />
          <span className="text-[1.05rem] font-bold tracking-tight leading-none">
            <span className="text-foreground">Trading</span><span className="text-muted-foreground font-medium">Engine</span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1 justify-self-center">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <Link key={href} href={href}>
                <Button variant={active ? 'secondary' : 'ghost'} size="sm" className="text-sm">
                  {label}
                </Button>
              </Link>
            );
          })}
        </nav>

        {/* Right: clock + trader ID */}
        <div className="flex items-center gap-4 justify-self-end">
          <div className="hidden sm:flex flex-col items-end text-sm font-mono">
            <span className="text-muted-foreground text-xs">{dateStr}</span>
            <span className="text-foreground tabular-nums">{timeStr}</span>
          </div>

          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
                placeholder="trader-id"
                className="w-28 bg-muted border border-ring rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none"
              />
              <button onClick={commit} className="text-emerald-500 hover:text-emerald-400">
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={openEdit}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors text-xs font-mono"
            >
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={traderId ? 'text-foreground' : 'text-muted-foreground'}>
                {traderId || 'set trader id'}
              </span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
