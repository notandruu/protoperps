# PRD: Protoperps — Synthetic Pre-IPO Perpetual Futures on Solana

## one-liner

a solana protocol that lets anyone trade perpetual futures on private company valuations (spacex, openai, anthropic, etc.) using a crankless orderbook and prestocks-derived oracle pricing, deployed to mainnet.

---

## context

### why this exists

pre-IPO company exposure is locked behind $50k+ minimums, accredited investor requirements, and opaque secondary markets. prestocks proved there's demand for tokenized access to private companies ($600M+ volume). but prestocks requires real SPV-backed shares, which means legal complexity, jurisdiction restrictions, and counterparty risk.

pre-IPO markets like prestocks and forge are long-only by default. there is no native way to short private company valuations or trade with leverage. while prestocks tokens are composable SPL tokens that could theoretically be borrowed and sold short via defi lending protocols, no lending protocol currently supports this, and the user experience for constructing a synthetic short is fragmented and manual. protoperps makes shorting and leverage first-class features with a single-click UX, purpose-built for pre-IPO exposure.

perpetual futures solve this differently: no real shares needed. users trade synthetic contracts that track private company valuations. the blockchain handles collateral, settlement, and price discovery. this is the same model that made crypto perps a $1.5T/month market.

### why onchain

this MUST be onchain because:
- trustless collateral custody: users deposit USDC, the program holds it, no counterparty can run off with funds
- transparent settlement: every trade, liquidation, and funding payment is verifiable
- composability: positions can be used as collateral in other defi protocols
- 24/7 markets: no market hours, no settlement delays
- permissionless access: anyone with a wallet can trade

### why now

- alliance dao batches (ALL14-ALL16) show stablecoin infra and prediction markets are the hottest funded categories
- prestocks validated demand for pre-IPO exposure onchain AND created liquid onchain price feeds for private companies via jupiter/raydium pools
- phoenix legacy's crankless orderbook showed high-performance matching is possible fully onchain

---

## product overview

### what it is

protoperps is a perpetual futures protocol on solana for synthetic pre-IPO company exposure. users deposit USDC as collateral and open long/short positions on private company valuations. there are no real shares involved, no SPVs, no securities law complexity.

### markets at launch

5 markets, chosen for maximum demand and data availability:
1. SPACEX-PERP
2. OPENAI-PERP
3. ANTHROPIC-PERP
4. ANDURIL-PERP
5. STRIPE-PERP

### how it works (user flow)

1. user connects solana wallet
2. user deposits USDC as collateral into their margin account
3. user selects a market (e.g. SPACEX-PERP)
4. user opens a long or short position with chosen leverage (up to 5x)
5. position is matched against the orderbook or filled by the AMM backstop
6. funding rates are applied periodically to keep prices anchored
7. user can close position at any time, profit/loss settled in USDC

---

## technical architecture

### design philosophy

minimal onchain footprint, maximum correctness. the solana program handles only what MUST be trustless: collateral custody, order matching, position tracking, liquidation, and settlement. everything else (oracle aggregation, keeper bots, frontend) lives offchain.

inspired by:
- phoenix legacy: crankless orderbook, single-account-per-market, seat system, red-black tree matching
- drift v2: cross-margin, funding rate mechanics, margin/liquidation engine
- prestocks: onchain price feeds for pre-IPO companies via DEX pools

### system components

#### 1. onchain program (anchor/rust)

**market state account** (one per market, inspired by phoenix's single-account design)
- orderbook: bid/ask sides stored as sorted data structures (red-black tree or BTreeMap)
- positions: maps trader pubkey -> position (entry price, size, side, collateral, unrealized PnL)
- market config: tick size, lot size, max leverage, initial/maintenance margin ratios
- oracle state: last price, TWAP, last update timestamp
- funding state: cumulative funding rate, last funding timestamp

**margin account** (one per user)
- deposited USDC collateral
- free collateral (available for new positions)
- locked collateral (backing open positions)
- unrealized PnL across all markets

**instructions**
- `initialize_market`: create a new perp market with config params
- `deposit_collateral`: deposit USDC into margin account
- `withdraw_collateral`: withdraw free collateral
- `place_order`: place a limit or market order (long/short)
- `cancel_order`: cancel a resting limit order
- `liquidate`: liquidate an undercollateralized position (callable by anyone, with reward)
- `update_funding`: update the funding rate (callable by keepers)
- `settle_funding`: apply accumulated funding to a position
- `update_oracle`: update the oracle price (callable by authorized oracle updaters)

**crankless matching** (from phoenix)
- orders match atomically within the same transaction
- no external crank needed for settlement
- all trader balances stored in the market account

#### 2. oracle system

**the core challenge**: there is no pyth/switchboard feed for private company valuations.

**solution: prestocks-derived oracle**

prestocks already has liquid tokens for spacex, openai, anthropic, anduril, and others trading on jupiter/raydium with real volume ($600M+). these onchain prices are the oracle.

**primary source: prestocks DEX pool prices**
- read prestocks token prices directly from jupiter/raydium pool accounts onchain
- the keeper bot fetches the price, computes a TWAP, and pushes it to the oracle program
- TWAP smoothing over a configurable window (e.g. 15 min) prevents flash manipulation

**secondary source: offchain secondary market data**
- keeper bot also pulls data from forge global, carta, equityzen where available
- funding round announcements trigger manual oracle updates (e.g. "openai raised at $300B")
- these serve as sanity checks and recalibration points

**no self-referential fallback**. if the oracle can't get a reliable price (e.g. prestocks pool is drained or stale), the market pauses trading until the oracle is restored. this is safer than letting the market price itself.

**oracle staleness protection**
- if oracle hasn't updated in X minutes, the market enters reduce-only mode (can close positions but not open new ones)
- if oracle hasn't updated in Y minutes, the market fully pauses
- this prevents trading on stale prices

**oracle program** (separate anchor program)
- stores price feeds per market
- accepts updates from authorized keepers only
- computes TWAP over configurable window
- enforces max price deviation between updates (e.g. 10% max change per update)
- exposes price data for the perps program to consume via CPI

#### 3. keeper bot (typescript)

offchain service that:
- fetches prestocks token prices from jupiter API and/or reads raydium/meteora pool state directly
- computes TWAP and pushes oracle updates onchain at regular intervals (e.g. every 30 seconds)
- cross-references with offchain secondary market data (forge, carta) when available
- triggers funding rate updates every hour
- monitors positions for liquidation opportunities
- executes liquidations when positions breach maintenance margin
- logs all oracle updates for transparency/auditability

#### 4. frontend (react + typescript)

**pages**
- landing: explain what protoperps is, link to app
- trade: main trading interface with orderbook, chart, position management
- portfolio: view open positions, margin balance, PnL history
- markets: overview of all available markets with prices and volume

**trading UI components**
- orderbook visualization (bid/ask depth)
- price chart (using TradingView lightweight charts or recharts)
- order entry form (market/limit, long/short, size, leverage slider)
- position table (open positions with entry, mark, PnL, liq price)
- collateral management (deposit/withdraw USDC)

**wallet integration**: solana wallet adapter (phantom, backpack, solflare)

---

## data model

### market account

```
Market {
  authority: Pubkey,
  base_symbol: String,          // e.g. "SPACEX"
  oracle: Pubkey,               // oracle account address
  
  // orderbook
  bids: BTreeMap<OrderId, Order>,
  asks: BTreeMap<OrderId, Order>,
  order_sequence_number: u64,
  
  // market params
  tick_size: u64,               // min price increment
  lot_size: u64,                // min size increment
  max_leverage: u64,            // e.g. 5 (5x)
  initial_margin_ratio: u64,    // e.g. 2000 (20%)
  maintenance_margin_ratio: u64,// e.g. 1000 (10%)
  taker_fee_bps: u64,
  maker_fee_bps: u64,
  
  // funding
  cumulative_funding_rate: i128,
  last_funding_timestamp: i64,
  funding_interval: i64,        // seconds between funding
  
  // stats
  open_interest: u64,
  volume_24h: u64,
}
```

### position

```
Position {
  trader: Pubkey,
  market: Pubkey,
  side: Side,                   // Long or Short
  size: u64,                    // in base lots
  entry_price: u64,             // average entry in ticks
  collateral: u64,              // USDC locked
  last_funding_rate: i128,      // for funding settlement
  realized_pnl: i64,
}
```

### order

```
Order {
  trader: Pubkey,
  side: Side,
  price: u64,                   // in ticks
  size: u64,                    // in base lots
  order_type: OrderType,        // Limit, Market, PostOnly
  sequence_number: u64,
  timestamp: i64,
}
```

### oracle price

```
OraclePrice {
  market: Pubkey,
  price: u64,
  confidence: u64,
  twap: u64,
  last_update_slot: u64,
  last_update_timestamp: i64,
  source: OracleSource,        // DEXPool, SecondaryMarket, FundingRound
  status: OracleStatus,        // Active, ReduceOnly, Paused
}
```

---

## key mechanics

### margin and leverage

- initial margin = position_notional / max_leverage
- maintenance margin = position_notional * maintenance_margin_ratio
- liquidation triggers when: collateral + unrealized_pnl < maintenance_margin
- liquidation reward: 5% of remaining collateral goes to liquidator

### funding rate

- calculated every 1 hour
- funding_rate = (mark_price - oracle_price) / oracle_price * funding_period_adjustment
- longs pay shorts when mark > oracle (premium)
- shorts pay longs when mark < oracle (discount)
- this mechanism keeps the perp price anchored to the oracle

### oracle dependency on prestocks

protoperps is intentionally parasitic on prestocks' price discovery. prestocks tokens trade on jupiter with real volume and real market participants setting prices. protoperps reads those prices and uses them as the oracle for its perp markets.

this means:
- protoperps does NOT need to bootstrap its own price discovery
- protoperps does NOT need real shares, SPVs, or any offchain asset backing
- the funding rate mechanism keeps protoperps prices aligned with prestocks prices
- if prestocks adds a new company token, protoperps can spin up a corresponding perp market

**risk**: if prestocks goes down or a token loses liquidity, that market's oracle goes stale and the market pauses. this is an acceptable tradeoff: it's safer than inventing a price with no external anchor.

### market circuit breakers

- if oracle price deviates more than 10% in a single update, the update is rejected and flagged for manual review
- if oracle hasn't updated in 5 minutes, market enters reduce-only mode
- if oracle hasn't updated in 15 minutes, market fully pauses (no new orders, existing positions frozen)
- admin can manually pause/unpause markets in emergencies

---

## build plan

### phase 1: core program

what to build:
- anchor program with market initialization
- margin account management (deposit/withdraw USDC)
- order placement and crankless matching engine
- position tracking and PnL calculation
- basic liquidation logic

deliverable: program deployed to devnet, passing integration tests

### phase 2: oracle + funding

what to build:
- oracle program (separate anchor program)
- keeper bot that fetches prestocks prices from jupiter/raydium pools
- TWAP computation and max deviation guards
- oracle staleness detection and market pausing logic
- funding rate calculation and settlement

deliverable: oracle feeding live prestocks prices onchain, funding rates updating, circuit breakers working

### phase 3: frontend

what to build:
- react app with wallet connection
- trading interface (orderbook, order entry, positions)
- market overview page
- collateral management UI

deliverable: working frontend connected to devnet program

### phase 4: mainnet

what to build:
- security review and testing
- mainnet deployment
- initialize 5 markets
- seed initial liquidity (can be your own funds or a market maker bot)
- landing page and docs

deliverable: live on mainnet with real trading

---

## tech stack

| component | technology |
|-----------|-----------|
| onchain program | rust, anchor framework |
| oracle program | rust, anchor framework |
| keeper bot | typescript, node.js |
| frontend | react, typescript, next.js |
| wallet integration | solana wallet adapter |
| charts | tradingview lightweight charts |
| styling | tailwind css |
| RPC | helius or triton |
| testing | anchor test framework, bankrun |

---

## risks and mitigations

### oracle manipulation
risk: someone manipulates prestocks token price on jupiter to trigger liquidations on protoperps
mitigation: TWAP smoothing (15 min window), max 10% deviation per update, multi-source cross-referencing with offchain data, reduce-only mode on stale oracle. manipulating a TWAP requires sustained capital over the full window, which is expensive

### prestocks dependency
risk: prestocks goes offline, removes a token, or loses liquidity
mitigation: market pauses automatically when oracle goes stale. this is by design: no oracle, no trading. markets can be manually migrated to alternative price sources if prestocks permanently shuts down

### low liquidity
risk: nobody trades, orderbook is empty
mitigation: run a market maker bot yourself that quotes both sides. this is standard practice for new markets

### smart contract bugs
risk: funds lost due to program bugs
mitigation: extensive testing, keep the program minimal, consider an audit before mainnet (or at least a peer review)

### regulatory
risk: synthetic perps on private companies could attract regulatory attention
mitigation: no US users (geo-restrict frontend), no real shares involved, users trade purely synthetic contracts. consult with legal if this gets real traction

---

## success metrics

- protocol deployed to mainnet
- 5 markets live and tradeable
- at least $1k in trading volume (even if self-generated)
- frontend live and usable
- clean codebase on github with docs

---

## what this is NOT

- NOT a tokenized stock platform (no real shares, no SPVs)
- NOT a prediction market (continuous trading, not binary outcomes)
- NOT an exchange with KYC (permissionless, wallet-based)
- NOT a copy of drift or phoenix (original program, inspired by their architectures)

---

## references

- phoenix legacy: github.com/Ellipsis-Labs/phoenix-v1
- drift v2: github.com/drift-labs/protocol-v2
- prestocks: prestocks.com
- phoenix gitbook: ellipsis-labs.gitbook.io/phoenix-dex
- drift docs: docs.drift.trade
- anchor framework: anchor-lang.com
