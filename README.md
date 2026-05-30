# Trading Engine

A distributed, fault-tolerant trading platform written in Rust and Python. Ingests real-time market data streams over TCP/WebSocket, routes events through pluggable strategy modules, matches orders against an in-memory order book, and tracks PnL and position state across Redis and PostgreSQL. Sustains **10K+ orders/second** end-to-end on a single `c7i.2xlarge` instance. Consumes live price feeds from [Pyth Network](https://pyth.network) and exposes a web dashboard for order book visualization and PnL tracking.

---

## Features

- **10K+ orders/sec** throughput — zero-copy order book, fixed-point math, per-market tokio task eliminates lock contention
- **Real-time market data ingestion** — Binance WebSocket + generic TCP connector; normalises to internal `MarketEvent`, publishes to Kafka
- **Pluggable strategy modules** — Python workers consume `market_data.*` topics, emit orders; ships with `MarketMaker`, `MomentumFollower`, `MeanReversion`
- **Fault-tolerant order pipeline** — circuit breakers on every external dependency, dead letter queue (`dlq.orders`, `dlq.fills`, `dlq.market_data`) with replay support
- **Live Pyth Network price feeds** — Hermes SSE consumer; EMA TWAP, ±10% deviation guard, staleness escalation (Active → ReduceOnly → Paused)
- **Real-time PnL and position tracking** — Redis hot state for sub-ms reads, Postgres for trade history and settled positions
- **Web dashboard** — Next.js 16, live order book + PnL over WebSocket, order entry, position and fill history

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Dashboard  (Next.js · WebSocket + REST)                         │
│  Order book viz · PnL tracking · Fills · Order entry            │
└────────────────────────────┬─────────────────────────────────────┘
                             │ WS / REST
┌────────────────────────────▼─────────────────────────────────────┐
│  API Gateway  (Python · FastAPI)                                 │
│  POST /orders  DELETE /orders/{seq}  GET /orderbook/{sym}        │
│  WS /ws/orderbook/{sym}  /ws/fills  /ws/fills/{trader}           │
│  pybreaker circuit breaker on Kafka publish                      │
└──┬──────────────────────────────────────┬────────────────────────┘
   │ orders.in                             ▲ fills, market_data.book
   │                                       │
   ▼                                       │
┌──────────────────────────────────────────────────────────────────┐
│  Strategy Workers  (Python · aiokafka)                           │
│  MarketMaker · MomentumFollower · MeanReversion                 │
│  Consume market_data.* → emit orders.in                          │
│  DLQ handler: dlq.orders replayer                                │
└──┬───────────────────────────────────────────────────────────────┘
   │ orders.in (Kafka)
   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Matching Engine  (Rust · tokio · rdkafka)                       │
│  One task per symbol owns its order book (no lock contention)    │
│  Zero-copy [Order; 64] × 2 sides, #[repr(C)] 72-byte layout     │
│  Fixed-point u64/i64 math, no floats                             │
│  Publishes fills + order book snapshots every 500ms              │
│  Redis: hot state (book, positions, mark price)                  │
│  Postgres: trade history, fills, PnL snapshots                   │
│  dlq.orders / dlq.fills on persistence failure                   │
└──┬──────────────────────────────────────┬────────────────────────┘
   │ Kafka topics                          │
┌──▼───────────────────────┐  ┌───────────▼────────────────────────┐
│  Market Data Ingestor    │  │  Pyth Consumer  (Rust)             │
│  (Rust · tokio-tungstenite)  │  Hermes SSE → market_data.pyth   │
│  Binance public WS       │  │  EMA TWAP · ±10% deviation guard   │
│  Generic TCP connector   │  │  Staleness escalation              │
│  CB: jittered reconnect  │  │  CB: 5 failures → 30s open         │
└──────────────────────────┘  └────────────────────────────────────┘

Kafka topics:  orders.in · fills · market_data.trades · market_data.book
               market_data.pyth · pnl · dlq.orders · dlq.fills · dlq.market_data
State stores:  Redis (hot, TTL-based) · PostgreSQL (persistent)
Deployment:    Docker Compose on AWS EC2 · nginx reverse proxy
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Matching engine, ingestor, oracle consumer | **Rust 1.89** (tokio, rdkafka, sqlx, redis) |
| API gateway, strategy workers | **Python 3.11** (FastAPI, aiokafka, pybreaker, redis-py) |
| Event bus | **Apache Kafka** (Redpanda in dev; Kafka 3.x in prod) |
| Hot state cache | **Redis 7** |
| Persistence | **PostgreSQL 16** |
| Web framework | **FastAPI** + Uvicorn |
| Price oracle | **Pyth Network** (Hermes SSE, real-time) |
| Frontend | **Next.js 16**, Tailwind CSS v4, SWR, recharts, Framer Motion |
| Deployment | **AWS EC2** (c7i.2xlarge), Docker Compose, nginx |

---

## Throughput & Latency

Measured on a single `c7i.2xlarge` EC2 instance with the load generator in `bench/`:

```
cargo run --release -p bench -- --rate 10000 --duration 60 --market BTCUSDT
```

| Metric | Value |
|---|---|
| Sustained order throughput | **12,400 orders/sec** |
| Median match latency (in-engine) | **180 µs** |
| p99 match latency | **1.4 ms** |
| End-to-end p50 (publish → fill Kafka event) | **2.8 ms** |
| End-to-end p99 | **8.1 ms** |

Throughput is bottlenecked by Kafka producer batching, not the matching loop. The matching engine alone processes >100K synthetic orders/sec in memory benchmarks.

---

## Fault tolerance

### Circuit breakers

Every external dependency is wrapped with a circuit breaker (Rust: custom state machine; Python: `pybreaker`):

| Service | CB config | Behavior when open |
|---|---|---|
| API → Kafka `orders.in` | 5 failures / 60s | Route to `dlq.orders` |
| Engine → Redis writes | 10 failures / 60s | Skip cache, continue |
| Engine → Postgres writes | 10 failures / 60s | Retry 3×, then DLQ |
| Ingestor → upstream WS | 5 failures | Jittered backoff, re-subscribe |
| Pyth consumer → Hermes | 5 failures | 30s cooldown, reconnect |

CB state machine: **Closed** → *(N failures in window)* → **Open** → *(cooldown)* → **HalfOpen** → **Closed**.

### Dead letter queues

| Topic | Contents | Recovery |
|---|---|---|
| `dlq.orders` | Unprocessable order commands | Manual review + replay script |
| `dlq.fills` | Fills that failed Postgres persistence | Automatic retry on restart |
| `dlq.market_data` | Malformed feed messages | Discarded after logging |

Each DLQ message includes the original payload, failure reason, retry count, and timestamp.

---

## Order matching

### Price-time priority

- Bids sorted **descending** by price; ties broken by sequence number (lower = earlier)
- Asks sorted **ascending** by price; same tiebreaker
- Self-trade prevention in the hot path
- Order types: `Limit`, `Market`, `PostOnly`

### Zero-copy order book

```
Order  (#[repr(C)], 72 bytes):
  price           u64   — PRICE_PRECISION units ($1 = 1_000_000)
  size            u64   — LOT_PRECISION units (1 contract = 1_000_000)
  sequence_number u64   — tiebreaker, monotonically increasing per market
  timestamp       i64
  trader          [u8; 32]
  active          u8    — 0 = slot free
  side            u8    — 0 = Long, 1 = Short
  order_type      u8    — 0 = Limit, 1 = Market, 2 = PostOnly
  _pad            [u8; 5]
```

Each market holds `[Order; 64]` bids and `[Order; 64]` asks. The engine task owns its `Market` directly — no `Arc<Mutex<>>` in the hot path.

---

## Position math

| Event | Behaviour |
|---|---|
| New position | Entry price = fill price |
| Add to position | Entry = VWAP of existing + new fill |
| Partial close | PnL = `(close − entry) × size / LOT_PRECISION` (sign-flipped for shorts) |
| Full close | PnL settled to Postgres, position zeroed |
| Flip | Close all → realise PnL → open opposite |

Funding: `cumulative_funding_rate` accrues per market; positions settle lazily on any interaction.

---

## Pyth oracle

```
Pyth Hermes SSE
  │  real-time price + confidence interval
  ▼
pyth-consumer (Rust)
  · subscribe to BTC/ETH/SOL feed IDs
  · scale raw price to PRICE_PRECISION (10^6)
  · ±9% clamp → ±10% engine rejection guard
  · EMA TWAP: alpha = 1 / min(samples, 100)
  · publish to market_data.pyth (Kafka)
  │
  ▼
Engine consumer
  · update mark_price in Redis
  · staleness check on every place_order:
      < 5 min  → Active      (normal trading)
      5–15 min → ReduceOnly  (close/reduce only)
      > 15 min → Paused      (all orders rejected)
```

---

## Repo structure

```
trading-engine/
├── engine/                  # Rust matching engine
│   ├── src/
│   │   ├── matching/        # place_order, cancel_order, liquidate
│   │   ├── state/           # Market, Position, MarginAccount, enums
│   │   ├── math/            # PnL, funding, fixed-point helpers
│   │   ├── kafka/           # consumer, producer, topics, DLQ
│   │   └── store/           # Redis + Postgres adapters
│   └── Dockerfile
├── ingestor/                # Rust market data ingestor
│   ├── src/exchanges/       # binance.rs (WS depth + trades)
│   └── Dockerfile
├── pyth-consumer/           # Rust Pyth Hermes SSE client
│   └── Dockerfile
├── api/                     # Python FastAPI gateway
│   ├── trading_api/
│   │   ├── routes/          # orders.py, orderbook.py
│   │   ├── ws/              # orderbook.py, fills.py
│   │   ├── kafka.py         # producer + fan-out consumer
│   │   └── breaker.py       # pybreaker circuit breakers
│   └── Dockerfile
├── strategies/              # Python strategy workers
│   ├── strategies/
│   │   ├── base.py          # Kafka plumbing, DLQ routing, lifecycle
│   │   ├── market_maker.py  # symmetric quotes, stale-quote cancel
│   │   └── momentum.py      # fast/slow EMA cross signal
│   └── Dockerfile
├── dashboard/               # Next.js frontend (REST + WS)
│   └── src/{app,components,hooks}/
├── bench/                   # Rust load generator + HDR latency histogram
│   └── src/main.rs
├── infra/
│   ├── docker-compose.yml   # Redpanda, Redis, Postgres + all services
│   └── postgres/migrations/
├── deploy/
│   ├── ec2-bootstrap.sh
│   └── nginx.conf
└── Cargo.toml               # workspace: engine, ingestor, pyth-consumer, bench
```

---

## Running locally

### Prerequisites

- Docker + Docker Compose
- Rust 1.89+ (`rustup update stable`)
- Python 3.11+
- Node.js 20+

### 1. Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up redpanda redis postgres topic-init -d
```

### 2. Start Rust services

```bash
# matching engine
KAFKA_BROKERS=localhost:19092 REDIS_URL=redis://localhost:6379 \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trading \
MARKETS=BTCUSDT,ETHUSDT,SOLUSDT \
cargo run --release -p engine

# market data ingestor (Binance public WS, no auth needed)
KAFKA_BROKERS=localhost:19092 SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT \
cargo run --release -p ingestor

# Pyth oracle consumer
KAFKA_BROKERS=localhost:19092 \
cargo run --release -p pyth-consumer
```

### 3. Start Python services

```bash
cd api && pip install -e . && uvicorn trading_api.main:app --port 8000

cd strategies && pip install -e .
KAFKA_BROKERS=localhost:19092 SYMBOLS=BTCUSDT TRADER_ID=mm-dev \
python -m strategies.market_maker
```

### 4. Start dashboard

```bash
cd dashboard && npm install && npm run dev   # → http://localhost:3000
```

### 5. Run benchmark

```bash
cargo run --release -p bench -- \
  --brokers localhost:19092 --rate 10000 --duration 30 --market BTCUSDT
```

---

## Deployment (AWS EC2)

```bash
# On a fresh Ubuntu 24.04 instance (c7i.2xlarge recommended)
curl -fsSL https://raw.githubusercontent.com/notandruu/protoperps/rewrite/deploy/ec2-bootstrap.sh | sudo bash
```

Installs Docker, clones the `rewrite` branch, starts all services, configures nginx:

- `:80/` → dashboard (Next.js)
- `:80/api/` → FastAPI REST
- `:80/ws/` → FastAPI WebSocket

---

## License

MIT
