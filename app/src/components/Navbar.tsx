'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletButton from './WalletButton';

const NAV_LINKS = [
  { href: '/', label: 'Markets' },
  { href: '/portfolio', label: 'Portfolio' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-surface/90 backdrop-blur-sm">
      <div className="max-w-screen-2xl mx-auto px-6 flex items-center h-14 gap-8">
        {/* Logo */}
        <Link href="/" className="text-white font-bold text-lg tracking-tight select-none">
          proto<span className="text-accent">perps</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  active
                    ? 'text-white bg-surface-2'
                    : 'text-text-muted hover:text-white'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto">
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}
