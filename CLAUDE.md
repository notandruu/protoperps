# CLAUDE.md — Protoperps

## project overview

protoperps is a perpetual futures protocol on solana for synthetic pre-IPO company exposure. users deposit USDC as collateral and open long/short positions on private company valuations (spacex, openai, anthropic, anduril, xai, neuralink, kalshi). no real shares, no SPVs, purely synthetic.

full PRD: ./docs/PRD.md

## repo structure

```
protoperps/
├── CLAUDE.md
├── docs/
│   └── PRD.md
├── programs/
│   ├── protoperps/          # core perps program (anchor/rust)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── state/       # account structs (market, position, order, margin)
│   │   │   ├── instructions/ # instruction handlers
│   │   │   ├── errors.rs
│   │   │   └── math/        # margin, funding rate, PnL calculations
│   │   └── Cargo.toml
│   └── oracle/              # oracle program (anchor/rust)
│       ├── src/
│       │   ├── lib.rs
│       │   ├── state/       # oracle price accounts
│       │   └── instructions/ # update_price, pause_market, etc.
│       └── Cargo.toml
├── keeper/                  # keeper bot (typescript)
│   ├── src/
│   │   ├── index.ts
│   │   ├── oracle.ts        # fetch prestocks prices, push onchain
│   │   ├── funding.ts       # trigger funding rate updates
│   │   └── liquidator.ts    # monitor and execute liquidations
│   ├── package.json
│   └── tsconfig.json
├── app/                     # frontend (next.js + react)
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   ├── package.json
│   └── next.config.js
├── tests/                   # integration tests
│   └── protoperps.ts
├── Anchor.toml
├── Cargo.toml
└── package.json
```

## build order (DO NOT SKIP PHASES)

build sequentially. do not start a later phase until the previous phase compiles, deploys to devnet, and passes tests.

### phase 1: core perps program
1. scaffold anchor workspace with `protoperps` and `oracle` programs
2. define state structs: Market, Position, Order, MarginAccount
3. implement instructions: initialize_market, deposit_collateral, withdraw_collateral
4. implement place_order with crankless matching (atomic settlement in same tx)
5. implement cancel_order
6. implement position tracking and PnL calculation
7. implement liquidation logic
8. write integration tests for every instruction
9. deploy to devnet

### phase 2: oracle + funding
1. define OraclePrice state struct
2. implement update_oracle instruction (authorized keepers only)
3. implement TWAP computation
4. implement max deviation guard (reject >10% price jumps)
5. implement staleness detection (reduce-only mode, full pause)
6. implement funding rate calculation and settle_funding instruction
7. build keeper bot: fetch prestocks prices from jupiter, push onchain
8. build keeper bot: trigger funding updates every hour
9. test oracle + funding end-to-end on devnet

### phase 3: frontend
1. scaffold next.js app with solana wallet adapter
2. build market overview page (list all markets with prices)
3. build trading page (orderbook, order entry, position table)
4. build portfolio page (margin balance, open positions, PnL)
5. build deposit/withdraw USDC flow
6. connect everything to devnet program via anchor client

### phase 4: mainnet
1. security review: check all math, all access controls, all edge cases
2. deploy programs to mainnet
3. initialize 7 markets
4. deploy keeper bot pointing at mainnet
5. deploy frontend
6. seed liquidity with market maker bot

## coding conventions

### rust / anchor
- use anchor framework (latest stable version)
- all amounts in u64, use fixed-point math with explicit precision constants
- define precision constants at the top of math modules (e.g. PRICE_PRECISION = 1_000_000)
- all division must check for zero divisor
- use custom error codes in errors.rs, never unwrap() in production code
- every instruction must validate all accounts (use anchor constraints)
- use #[account(constraint = ...)] for access control checks
- keep instruction handlers thin: validate -> compute -> mutate -> emit event
- emit events for every state change (for indexing and frontend)
- no floating point math anywhere in the onchain program

### typescript
- use strict typescript (no any)
- use @coral-xyz/anchor for program interaction
- use @solana/web3.js for RPC
- use BN.js for all numeric operations (never javascript Number for token amounts)
- keeper bot: use exponential backoff for RPC retries
- frontend: use react-query or SWR for data fetching

### naming
- snake_case for rust
- camelCase for typescript
- program accounts: PascalCase (Market, Position, OraclePrice)
- instructions: snake_case (place_order, update_funding)

## key design decisions (DO NOT DEVIATE)

### crankless matching
all order matching must happen atomically within the place_order transaction. do not introduce an external crank or async settlement. trader balances are stored in the market account, not in separate token accounts per user. this is the core architectural insight from phoenix.

### oracle design
- primary source: prestocks token prices from jupiter/raydium DEX pools
- keeper bot fetches prices offchain and pushes onchain via update_oracle instruction
- TWAP smoothing over 15 min window
- max 10% price deviation per update, reject otherwise
- NO self-referential oracle. do not use protoperps' own mark price as the oracle. ever.
- if oracle is stale (5 min), market goes reduce-only
- if oracle is stale (15 min), market fully pauses

### margin system
- USDC only as collateral
- max 5x leverage
- initial margin ratio: 20% (1/5)
- maintenance margin ratio: 10%
- liquidation reward: 5% of remaining collateral to liquidator
- no cross-margin (each position has its own collateral for v1, simpler)

### funding rate
- calculated every 1 hour
- funding_rate = (mark_price - oracle_price) / oracle_price * (1/24)
- longs pay shorts when mark > oracle
- shorts pay longs when mark < oracle
- cumulative funding stored on market account
- each position tracks last_funding_rate for settlement delta

## reference code to study

read these before writing any code:

- phoenix v1 orderbook: github.com/Ellipsis-Labs/phoenix-v1 (especially src/state/ and src/program/processor/)
- phoenix gitbook: ellipsis-labs.gitbook.io/phoenix-dex (market structure, seats, events, matching)
- drift v2 perps: github.com/drift-labs/protocol-v2 (funding rate, margin, liquidation patterns)
- drift docs on prelaunch markets: docs.drift.trade/trading/market-specs (contract tiers, oracle handling)
- anchor examples: github.com/coral-xyz/anchor/tree/master/examples

## what NOT to do

- do NOT build a self-referential oracle
- do NOT use floating point math onchain
- do NOT use BTreeMap from std library in anchor accounts (use fixed-size arrays or custom sorted structures that fit in account space)
- do NOT try to store unlimited orders: cap orderbook depth (e.g. 128 bids, 128 asks)
- do NOT build cross-margin in v1: isolated margin per position is simpler and safer
- do NOT over-engineer: the goal is a working MVP, not a production-grade exchange
- do NOT skip tests: every instruction needs at least one happy path and one error case test
- do NOT use localStorage or sessionStorage in the frontend (not supported in claude artifacts)
- do NOT deploy to mainnet without testing every instruction on devnet first

## markets at launch

| market | symbol | prestocks token to track |
|--------|--------|-------------------------|
| SpaceX | SPACEX-PERP | SPACEX on jupiter |
| OpenAI | OPENAI-PERP | OPENAI on jupiter |
| Anthropic | ANTHROPIC-PERP | ANTHRP on jupiter |
| Anduril | ANDURIL-PERP | ANDURL on jupiter |
| xAI | XAI-PERP | xAI on jupiter (substitutes for STRIPE-PERP; no Stripe prestocks confirmed) |
| Neuralink | NRLNK-PERP | Neuralink on jupiter (placeholder; update when listed) |
| Kalshi | KALSHI-PERP | Kalshi on jupiter (placeholder; mirrors xAI until listed) |

## environment

- solana CLI installed
- anchor CLI installed (latest stable)
- node.js 18+
- rust toolchain (stable)
- devnet RPC: use default or helius
- mainnet RPC: helius or triton (need paid plan for reliability)

## testing

- use anchor test framework with bankrun for fast local tests
- test every instruction: happy path + at least one failure case
- test margin math edge cases: exactly at liquidation threshold, just above, just below
- test oracle staleness: simulate stale oracle, verify market pauses
- test funding rate: verify longs pay shorts when mark > oracle and vice versa
- test orderbook matching: limit orders crossing, partial fills, self-trade prevention
