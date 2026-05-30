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
    title: 'Trading Engine',
    items: [
      {
        q: 'What is this trading engine?',
        a: 'A distributed perpetual futures trading engine written in Rust and Python. It ingests real-time market data over WebSocket, routes order events through Kafka, matches orders against an in-memory order book, and tracks PnL and position state in Redis and PostgreSQL.',
      },
      {
        q: 'What markets are supported?',
        a: 'BTCUSDT, ETHUSDT, and SOLUSDT perpetuals. Mark prices come from Pyth Network via Hermes SSE in real time.',
      },
      {
        q: 'How does order matching work?',
        a: 'Each market runs in a dedicated tokio task that owns its order book with no shared locks in the hot path. Orders arrive over Kafka (orders.in), match using price-time priority, and produce fills published back to Kafka and persisted to PostgreSQL. Throughput is 12,400 orders/sec sustained on a single EC2 instance.',
      },
      {
        q: 'What order types are supported?',
        a: 'Limit, Market, and PostOnly. Bids sort descending by price (ties broken by sequence number); asks sort ascending. Self-trade prevention runs in the hot path.',
      },
      {
        q: 'What is the margin model?',
        a: 'Isolated margin — each position carries its own collateral. One losing trade cannot drain collateral from another position. Maximum leverage is 50×. Initial margin is 2% of notional; maintenance margin is 1%.',
      },
    ],
  },
  {
    title: 'Price Oracle',
    items: [
      {
        q: 'Where do prices come from?',
        a: 'Prices come from Pyth Network via the Hermes SSE endpoint at hermes.pyth.network. The pyth-consumer service subscribes to BTC/ETH/SOL feed IDs, scales raw prices to PRICE_PRECISION (10^6), and applies an EMA TWAP with a ±10% deviation guard before publishing to Kafka.',
      },
      {
        q: 'What is the deviation guard?',
        a: 'Any price update that deviates more than ±9% from the current EMA TWAP is clamped before publishing. The engine also enforces a ±10% rejection at order placement time, so extreme single-update price spikes cannot be exploited.',
      },
      {
        q: 'What does Active, Reduce Only, and Paused mean?',
        a: 'Active: oracle updated within the last 5 minutes — full trading allowed. Reduce Only: oracle is 5–15 minutes stale — you can close or reduce positions only. Paused: oracle is more than 15 minutes stale — all new orders are rejected until the feed recovers.',
      },
      {
        q: 'What is the EMA TWAP?',
        a: 'The pyth-consumer maintains an exponential moving average of submitted prices: alpha = 1 / min(samples, 100). This prevents a single outlier from moving the mark price significantly, and the ±9% clamp prevents the TWAP itself from being driven too far from the spot price.',
      },
    ],
  },
  {
    title: 'Fault Tolerance',
    items: [
      {
        q: 'How does the engine handle failures?',
        a: 'Every external dependency is wrapped in a circuit breaker. The API gateway uses pybreaker; the engine uses a custom Rust state machine. When a breaker opens, orders route to dead letter queue (DLQ) topics for manual review or replay.',
      },
      {
        q: 'What are the DLQ topics?',
        a: 'dlq.orders (unprocessable order commands), dlq.fills (fills that failed Postgres persistence), dlq.market_data (malformed feed messages). Each DLQ message includes the original payload, failure reason, retry count, and timestamp.',
      },
      {
        q: 'What happens if Redis goes down?',
        a: 'The engine circuit breaker for Redis writes (threshold: 10 failures / 60s) opens and the engine skips the cache update while continuing to match orders. The order book state is preserved in-memory and Postgres catches the fills.',
      },
    ],
  },
  {
    title: 'Using the Dashboard',
    items: [
      {
        q: 'How do I place a trade?',
        a: 'Set a trader ID using the button in the top-right header — this is your identity on the order book. Navigate to any market, enter a price and size, select Long or Short, and click Place Order. The order routes to the matching engine via Kafka.',
      },
      {
        q: 'How do I view my positions?',
        a: 'Your open positions appear on the trade page under "My Position" and on the Portfolio page. They are fetched in real time from the REST API, which reads directly from PostgreSQL.',
      },
      {
        q: 'How do I cancel an order?',
        a: 'Navigate to the trade page for your market and click the "Cancel Order" tab. Enter the sequence number of the resting order (printed when the order is accepted) and submit. The cancel routes through Kafka to the matching engine.',
      },
      {
        q: 'What is the trader ID?',
        a: 'A plain string used as your identity on the order book — analogous to a wallet address but without cryptographic signing. Set it once in the header; it persists in localStorage. Strategy workers use IDs like "mm-prod" or "momentum-1".',
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
        <ChevronDown className={cn(
          'shrink-0 w-4 h-4 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
        )} />
      </button>
      {open && (
        <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
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
          How the trading engine works and what you need to know before trading.
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
