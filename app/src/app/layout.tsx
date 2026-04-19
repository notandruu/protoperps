import type { Metadata } from 'next';
import '@solana/wallet-adapter-react-ui/styles.css';
import './globals.css';
import SolanaProvider from '@/providers/SolanaProvider';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'Protoperps — Synthetic Pre-IPO Perps',
  description: 'Trade perpetual futures on SpaceX, OpenAI, Anthropic, and more on Solana.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-slate-200 antialiased">
        <SolanaProvider>
          <Navbar />
          <main className="max-w-screen-2xl mx-auto px-6 py-6">
            {children}
          </main>
        </SolanaProvider>
      </body>
    </html>
  );
}
