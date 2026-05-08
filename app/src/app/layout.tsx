import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '@solana/wallet-adapter-react-ui/styles.css';
import './globals.css';
import SolanaProvider from '@/providers/SolanaProvider';
import Navbar from '@/components/Navbar';
import PageTransition from '@/components/PageTransition';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Protoperps — Synthetic Pre-IPO Perps',
  description: 'Trade perpetual futures on SpaceX, OpenAI, Anthropic, and more on Solana.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark bg-background">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground transition-colors duration-300 min-h-screen pb-8`}>
        <SolanaProvider>
          <div className="container mx-auto px-4">
            <Navbar />
            <main className="py-6">
              <PageTransition>{children}</PageTransition>
            </main>
          </div>
        </SolanaProvider>
      </body>
    </html>
  );
}
