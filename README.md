# Trading Engine

A distributed trading platform that ingests real-time market data streams over TCP/WebSocket, processes events through strategy modules, and tracks PnL and order book state in real time. Processes 10K+ orders per second with fault-tolerant order execution via dead letter queue and circuit breaker patterns. Consumes live [Pyth Network](https://pyth.network) price feeds; includes a web dashboard for real-time order book visualization and PnL tracking.

---

## Features

- **10K+ orders/sec** throughput with sub-millisecond matching latency
- Real-time market data ingestion over TCP/WebSocket
- Strategy module event processing pipeline
- Fault-tolerant order execution — dead letter queue + circuit breaker
- Live Pyth Network price feeds with staleness detection and TWAP
- PnL and order book state tracking
- Web dashboard for real-time order book visualization and PnL tracking

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Core engine | Rust |
| API / strategy layer | Python, FastAPI |
| Message streaming | Kafka |
| State cache | Redis |
| Persistence | PostgreSQL |
| Deployment | AWS EC2 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Web Dashboard                              │
│  Order book visualization · PnL tracking · Trade interface     │
│  WebSocket streaming · REST API client                          │
└────────────────────────┬────────────────────────────────────────┘
                         │ reads / writes
┌────────────────────────▼────────────────────────────────────────┐
│               FastAPI (Python)                                  │
│                                                                 │
│  Strategy modules  — event processing pipeline                  │
│  Order management  — submission, cancellation, fills           │
│  PnL tracking      — real-time position valuation              │
│                                                                 │
│  place_order   cancel_order   liquidate                         │
│  deposit_collateral   withdraw_collateral                       │
│  update_funding   settle_funding                                │
└───────────────┬───────────────────────┬─────────────────────────┘
                │ reads price feed      │ publishes / consumes
┌───────────────▼──────────┐   ┌────────▼──────────────────────────┐
│  Pyth Network             │   │  Kafka                            │
│  (price oracle)           │   │                                   │
│                           │   │  market data streams (TCP/WS)     │
│  Real-time price feeds    │   │  order events                     │
│  Confidence intervals     │   │  PnL updates                      │
│  TWAP                     │   │  dead letter queue                │
│  Staleness detection      │   │                                   │
└───────────────────────────┘   └───────────────────────────────────┘
```

---

## Matching engine

### Crankless matching

Every `place_order` call resolves the full trade atomically. There is no external crank, no async settlement queue, no off-chain order routing. The matching engine fills against the in-memory order book in price-time priority and settles all positions within the same operation.

### Zero-copy order book

The order book stores `[Order; 64]` bids and `[Order; 64]` asks using a zero-copy, memory-mapped layout. No heap or stack copy is created on deserialisation.

```
Order layout (#[repr(C)], 72 bytes, no implicit padding):
  price           u64     (8)
  size            u64     (8)
  sequence_number u64     (8)   — tiebreaker: lower = earlier = higher priority
  timestamp       i64     (8)
  trader          [u8;32] (32)
  active          u8      (1)   — 0 = slot free, 1 = live
  side            u8      (1)   — 0 = Long, 1 = Short
  order_type      u8      (1)   — 0 = Limit, 1 = Market, 2 = PostOnly
  _pad            [u8;5]  (5)   — explicit, total = 72 = 9 × 8 ✓
```

Bids are kept sorted descending by price; asks ascending. Self-trade prevention is enforced in the matching loop.

### Isolated margin

Each position carries its own USDC collateral — no cross-margin in v1. `usdc_locked` tracks total collateral committed across all open positions.

```
free_collateral = usdc_deposited − usdc_locked
```

### Position math

| Event | Behaviour |
|-------|-----------|
| New position | Entry price = fill price |
| Add to position | Entry price recalculated as VWAP |
| Partial close | PnL = `(close − entry) × size / LOT_PRECISION` (sign-flipped for shorts) |
| Full close | PnL settled, position zeroed |
| Flip | Close all → realise PnL → open opposite |

### Risk parameters

| Parameter | Value |
|-----------|-------|
| Max leverage | 50× |
| Initial margin ratio | 2% |
| Maintenance margin ratio | 1% |
| Liquidation reward | 5% of remaining collateral |
| Collateral | USDC only |
| Order book depth | 64 bids / 64 asks per market |
| Max fills per batch | 5 |

---

## Oracle design

### Price feed lifecycle

```
Pyth Network price feeds
  (real-time price + confidence interval per market)
        │ on update
        ▼
  oracle service (Rust)
  · reads latest Pyth price
  · clamps new price to ±9% of previous price
  · pushes to internal price store
        │
        ▼
  Price store (Redis)
  · rejects if |new − previous| / previous > 10%
  · updates EMA TWAP
  · records timestamp for staleness tracking
        │
        ▼
  matching engine :: place_order
  · reads current price
  · checks effective status (Active / ReduceOnly / Paused)
  · rejects new orders if not Active
```

### Staleness escalation

| Age since last update | Oracle status |
|-----------------------|---------------|
| < 5 minutes | Active — normal trading |
| 5 – 15 minutes | Reduce-only — close/reduce positions only |
| > 15 minutes | Paused — all orders rejected |

### TWAP (EMA)

```
twap_new = twap_old + (new_price − twap_old) / min(sample_count, 100)
```

Alpha floors at 1% (100 samples). A single outlier price can move the TWAP by at most 1%.

### Deviation guard

```rust
// Reject if: |new − previous| / previous > 10%
diff.saturating_mul(10_000) > previous.saturating_mul(1_000)
```

When prices diverge significantly from the last stored price, the ±9% clamp in the feed client allows gradual convergence over 3–5 ticks (~2.5 minutes) without triggering rejection.

---

## Funding rate

The funding mechanism keeps the engine's mark price aligned with the oracle (Pyth Network price):

```
funding_rate = (mark_price − oracle_price) / oracle_price × (1/24)
```

- Computed and applied hourly
- **Longs pay shorts** when mark > oracle (perp is at a premium)
- **Shorts pay longs** when mark < oracle (perp is at a discount)
- `Market::cumulative_funding_rate` (i64) accumulates the running sum
- Each position stores `last_funding_rate`; unsettled funding is applied lazily on any position interaction

---

## How a trade works end-to-end

```
1. Deposit collateral
   trader → deposit_collateral
   MarginAccount.usdc_deposited += amount

2. Place order  (e.g. Long 0.1 @ market)
   · oracle checked: must be Active
   · matching engine walks asks, fills up to 5 makers per batch
   · maker positions updated atomically
   · required initial margin (2%) locked from free_collateral
   · if unfilled: resting limit order inserted into order book

3. Position lives
   · mark price tracked via Pyth feed updates
   · funding accrues hourly in cumulative_funding_rate
   · unrealized PnL = (mark − entry) × size / LOT_PRECISION

4. Close position
   · trader places opposing market order
   · fills against resting bids, PnL released, collateral unlocked

5. Withdraw
   · withdraw for any free_collateral
```

---

## Liquidation

When `equity / notional < 1%` (maintenance margin breached):

```
equity   = collateral + unrealized_pnl
notional = mark_price × size / LOT_PRECISION
```

Any process can trigger liquidation. The liquidator:
- Closes the position at mark price
- Receives 5% of the remaining collateral as a reward
- Remaining collateral is returned to the trader

---

## Precision constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `PRICE_PRECISION` | 1,000,000 | $1.00 = 1,000,000 |
| `LOT_PRECISION` | 1,000,000 | 1 unit = 1,000,000 |
| `BPS_PRECISION` | 10,000 | 100% = 10,000 bps |
| `FUNDING_PRECISION` | 1,000,000,000 | 1.0 funding = 1e9 |

All arithmetic uses `u64` / `i64` fixed-point with explicit checked operations. No floating point anywhere in the core engine.

---

## Account layout (key fields)

### Price (136 bytes)

```
offset   field                  type
     0   bump / source / status u8 × 3
     3   _pad0                  [u8;5]
     8   authority              [u8;32]
    40   market                 [u8;32]
    72   price                  u64        ← current price
    80   confidence             u64
    88   twap                   u64        ← EMA
    96   previous_price         u64        ← deviation guard uses this
   104   twap_samples           u64
   112   last_update_slot       u64
   120   last_update_timestamp  i64        ← staleness computed from this
```

### Market

Zero-copy. Holds the full sorted order book, market parameters, cumulative funding rate, open interest, and volume.

### Position

```
market          [u8;32]
trader          [u8;32]
side            Long | Short
size            u64   (LOT_PRECISION)
entry_price     u64   (PRICE_PRECISION, VWAP)
collateral      u64   (USDC)
last_funding_rate i64
realized_pnl    i64
```

---

## Repo structure

```
trading-engine/
├── engine/                       # Rust core
│   └── src/
│       ├── matching/
│       │   ├── place_order.rs    # Matching engine + position math
│       │   ├── cancel_order.rs
│       │   └── liquidate.rs
│       ├── margin/
│       │   ├── deposit.rs
│       │   └── withdraw.rs
│       ├── funding/
│       │   ├── update_funding.rs
│       │   └── settle_funding.rs
│       ├── state/
│       │   ├── market.rs         # Zero-copy Market + Order structs
│       │   ├── position.rs
│       │   └── margin.rs
│       ├── oracle_client.rs      # Pyth price feed reader
│       └── errors.rs
├── api/                          # Python / FastAPI
│   ├── main.py
│   ├── routes/
│   │   ├── orders.py
│   │   ├── positions.py
│   │   └── pnl.py
│   └── strategy/                 # Strategy modules
│       ├── base.py
│       └── market_maker.py
├── infra/
│   ├── kafka/                    # Topic configs, consumer groups
│   ├── redis/                    # Cache schemas
│   └── postgres/                 # Migrations
├── keeper/
│   └── src/
│       ├── oracle.ts             # Pyth → price store push
│       ├── funding.ts            # Hourly funding rate trigger
│       ├── liquidator.ts         # Scan + execute liquidations
│       └── config.ts             # Market configs
├── app/                          # Web dashboard
│   └── src/
│       ├── app/
│       │   ├── page.tsx          # Markets overview
│       │   ├── trade/[symbol]/page.tsx
│       │   └── portfolio/page.tsx
│       ├── components/
│       │   ├── markets/MarketsTable.tsx
│       │   └── trade/
│       │       ├── OrderBook.tsx
│       │       ├── OrderEntry.tsx
│       │       ├── PositionsTable.tsx
│       │       └── PriceChart.tsx
│       └── hooks/
│           ├── useOracle.ts
│           ├── useMarket.ts
│           ├── usePosition.ts
│           └── usePnl.ts
└── tests/
```

---

## Running locally

### Prerequisites

```bash
rustup update stable
python 3.11+
docker compose   # for Kafka, Redis, PostgreSQL
```

### 1. Start infrastructure

```bash
docker compose up -d   # Kafka, Redis, PostgreSQL
```

### 2. Start the engine

```bash
cargo build --release
./target/release/trading-engine
```

### 3. Start the API

```bash
cd api && pip install -r requirements.txt
uvicorn main:app --reload
```

### 4. Start the keeper

```bash
cd keeper && npm install && npm run start
```

### 5. Start the frontend

```bash
cd app && npm install && npm run dev
# → http://localhost:3000
```

### 6. Run tests

```bash
cargo test
pytest api/tests/
```

---

## Acknowledgements

Architecture inspired by:
- **[Phoenix v1](https://github.com/Ellipsis-Labs/phoenix-v1)** — crankless order book, zero-copy account design, batch fill pattern
- **[Drift Protocol v2](https://github.com/drift-labs/protocol-v2)** — funding rate mechanics, oracle staleness escalation, margin system design
