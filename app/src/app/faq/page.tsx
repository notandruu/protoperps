'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

interface FAQItem {
  q: string;
  a: string;
}

const SECTIONS: { title: string; items: FAQItem[] }[] = [
  {
    title: 'ProtoPerps',
    items: [
      {
        q: 'What is ProtoPerps?',
        a: 'ProtoPerps is a synthetic perpetual futures protocol on Solana. It lets you trade long or short exposure to private company valuations with up to 50x leverage, using USDC as collateral. No real shares change hands. Everything settles on-chain.',
      },
      {
        q: 'What is a perpetual future?',
        a: 'A perpetual future (perp) is a leveraged derivative that tracks an asset\'s price with no expiry date. You hold it indefinitely and your PnL updates in real time as price moves against your entry. A funding rate keeps the perp price anchored to the underlying oracle price: when the perp trades above oracle, longs pay shorts; when it trades below, shorts pay longs.',
      },
      {
        q: 'What makes ProtoPerps synthetic?',
        a: 'Synthetic means the underlying asset (SpaceX shares, OpenAI equity) never moves on-chain. Only USDC does. Every long is matched against a short in a direct counterparty orderbook. PnL is computed from price differences and settled in USDC. This is different from a debt-pool protocol like Synthetix, where a shared liquidity pool absorbs all risk.',
      },
      {
        q: 'How does order matching work?',
        a: 'ProtoPerps uses crankless matching. Every place_order transaction resolves the full trade atomically on-chain in price-time priority. There is no external crank, no off-chain relay, and no async settlement. If your order fills against a maker, both sides update in the same transaction.',
      },
      {
        q: 'What is the margin model?',
        a: 'ProtoPerps uses isolated margin. Each position carries its own USDC collateral independently. One losing trade cannot drain collateral from another position. Initial margin required is 2% of notional (50x max leverage). Maintenance margin is 1%. Falling below 1% triggers liquidation.',
      },
      {
        q: 'What is the funding rate?',
        a: 'Funding rate = (mark price minus oracle price) / oracle price / 24, computed and settled once per hour. When the perp trades at a premium, longs pay shorts. When it trades at a discount, shorts pay longs. This keeps the perp price anchored to the Prestocks token price over time.',
      },
      {
        q: 'What happens when I get liquidated?',
        a: 'When your equity falls below 1% of notional, any wallet can liquidate your position. The liquidator receives 5% of your remaining collateral as a reward. The rest is returned to you. Equity is your collateral plus unrealized PnL.',
      },
      {
        q: 'What collateral is accepted?',
        a: 'USDC only. Deposit USDC to open positions and withdraw at any time up to your free collateral (deposited minus locked in open positions).',
      },
      {
        q: 'Is there a maximum order size or leverage?',
        a: 'Maximum leverage is 50x, enforced by the 2% initial margin requirement. The orderbook holds up to 64 bids and 64 asks per market. A single transaction can fill against up to 5 makers.',
      },
    ],
  },
  {
    title: 'Price Oracle',
    items: [
      {
        q: 'Where do prices come from?',
        a: 'Prices come from Prestocks DEX pools on Solana mainnet, fetched via Dexscreener every 30 seconds. A keeper bot picks the highest-liquidity pair for each market, clamps the price to within 9% of the last on-chain price, and pushes it to the oracle program on devnet.',
      },
      {
        q: 'What stops the oracle from being manipulated?',
        a: 'The on-chain oracle program rejects any price update where the new price deviates more than 10% from the previous accepted price. Only the authorized keeper wallet can push updates. If the keeper stops for 5 minutes, the market enters reduce-only mode. After 15 minutes, trading fully pauses.',
      },
      {
        q: 'What is the TWAP?',
        a: 'The Time-Weighted Average Price is an exponential moving average (EMA) of submitted prices. Alpha decreases as more samples accumulate, flooring at 1% (100 samples). This prevents a single outlier price from moving the TWAP significantly.',
      },
      {
        q: 'What does Active, Reduce Only, and Paused mean?',
        a: 'Active means full trading is open. Reduce Only means the oracle is slightly stale (5 to 15 minutes since last update) so you can only close or reduce existing positions. Paused means the oracle is stale beyond 15 minutes and all orders are rejected until the keeper resumes.',
      },
    ],
  },
  {
    title: 'Prestocks Tokens',
    items: [
      {
        q: 'What are Prestocks tokens?',
        a: 'Prestocks tokens are SPL tokens on Solana that track the price of individual private companies. Each token represents the implied gross price per share of the referenced company, backed by holding entities that are directly or indirectly invested in that company.',
      },
      {
        q: 'Why use Prestocks prices as the oracle?',
        a: 'Prestocks tokens trade 24/7 on Solana DEX pools with real-time pricing and on-chain liquidity. They are the only continuously-priced, on-chain signal for private company valuations like SpaceX and OpenAI. ProtoPerps tracks the highest-liquidity Prestocks pool for each market.',
      },
      {
        q: 'Can I trade Prestocks tokens directly on ProtoPerps?',
        a: 'No. ProtoPerps does not hold or transfer Prestocks tokens. It only uses their DEX price as the oracle feed. To buy or sell actual Prestocks tokens, go to prestocks.com.',
      },
      {
        q: 'What is the difference between the token price and the implied valuation?',
        a: 'The token price is the gross per-share price of the company (e.g. $1,802 for OpenAI). The implied valuation multiplies that per-share price by the total share count to get the full company valuation (e.g. $1.5T). ProtoPerps uses the per-share token price directly as the mark price.',
      },
    ],
  },
  {
    title: 'Getting Started',
    items: [
      {
        q: 'How do I start trading?',
        a: 'Connect a Solana wallet (Phantom, Backpack, or Solflare). Use the faucet on the Portfolio page to receive devnet USDC. Deposit USDC as collateral. Go to any market, place a long or short order, and your position opens instantly.',
      },
      {
        q: 'Is ProtoPerps live on mainnet?',
        a: 'ProtoPerps currently runs on Solana devnet. The oracle tracks real mainnet Prestocks token prices, so mark prices reflect live valuations. All trading and settlement happens on devnet with devnet USDC.',
      },
      {
        q: 'Are there fees?',
        a: 'No protocol fees in the current version. You pay standard Solana transaction fees (fractions of a cent). Funding rate payments between longs and shorts apply hourly.',
      },
      {
        q: 'How do I close a position?',
        a: 'Go to the trade page for your market. In the My Position panel, click Close All to submit a market order for your full size, or enter a size and click Close for a partial close. The position settles atomically on-chain at the best available price.',
      },
    ],
  },
];

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center justify-between gap-4 py-4 text-left group"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-medium text-foreground group-hover:text-foreground/80 transition-colors">
          {item.q}
        </span>
        <ChevronDown
          className={cn(
            'shrink-0 w-4 h-4 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <p className="pb-4 text-sm text-muted-foreground leading-relaxed">
          {item.a}
        </p>
      )}
    </div>
  );
}

export default function FAQPage() {
  return (
    <div className="max-w-2xl mx-auto pb-16">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">FAQ</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How ProtoPerps works and what you need to know before trading.
        </p>
      </div>

      <div className="space-y-8">
        {SECTIONS.map(section => (
          <div key={section.title}>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
              {section.title}
            </h2>
            <div className="rounded-lg border border-border bg-card px-4">
              {section.items.map(item => (
                <FAQAccordion key={item.q} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
