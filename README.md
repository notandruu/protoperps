# protoperps

Synthetic perpetual futures on private company valuations — trade long/short exposure to SpaceX, OpenAI, Anthropic, and more on Solana.

**Live app:** protoperps.vercel.app / protoperps.xyz

---

## Tech stack

| Layer | Technology |
|---|---|
| Onchain program | Anchor (Rust), Solana |
| Oracle program | Anchor (Rust), custom keeper |
| Keeper bot | TypeScript, `@coral-xyz/anchor`, Jupiter Price API |
| Frontend | Next.js 14, Tailwind CSS, Solana Wallet Adapter, Recharts, SWR |
| Deployment | Vercel (frontend), devnet/mainnet (programs) |

---

## Running locally

### Prerequisites

- Rust toolchain (stable) — `rustup update stable`
- Solana CLI — `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
- Anchor CLI — `cargo install --git https://github.com/coral-xyz/anchor avm && avm install latest`
- Node.js 18+

### 1 — Build and deploy the programs

```bash
anchor build
anchor deploy --provider.cluster devnet
```

### 2 — Run the keeper bot

```bash
# Copy and edit .env
cp keeper/.env.example keeper/.env
# Set KEYPAIR_PATH, RPC_URL in keeper/.env

cd keeper
npm install
npm run start
```

### 3 — Run the frontend

```bash
cd app
npm install
npm run dev
# → http://localhost:3000
```

Set optional env vars in `app/.env.local`:

```
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

### 4 — Run integration tests

```bash
# Requires a local validator or bankrun (tests use bankrun by default)
anchor test
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                │
│  Markets overview · Trade page · Portfolio            │
│  Wallet Adapter → Anchor client → Devnet RPC          │
└───────────────────────┬──────────────────────────────┘
                        │ reads / writes
┌───────────────────────▼──────────────────────────────┐
│              protoperps program (Anchor/Rust)         │
│                                                       │
│  Market accounts (orderbook, funding, OI)             │
│  Position accounts (per trader per market)            │
│  MarginAccount PDAs (USDC collateral)                 │
│                                                       │
│  Instructions: place_order · cancel_order             │
│                deposit/withdraw · liquidate           │
│                update_funding · settle_funding        │
└────────────┬──────────────────┬───────────────────────┘
             │ reads oracle     │ called by keeper
┌────────────▼────────┐  ┌──────▼──────────────────────┐
│  oracle program     │  │  keeper bot (TypeScript)     │
│                     │  │                              │
│  OraclePrice PDAs   │  │  oracle.ts  — fetch Prestocks│
│  update_price       │  │             prices, push     │
│  pause_market       │  │  funding.ts — hourly funding │
│  TWAP · deviation   │  │  liquidator.ts — scan & liq  │
│  staleness guard    │  └──────────────────────────────┘
└─────────────────────┘
```

### Key design decisions

- **Crankless matching** — orders settle atomically in the same transaction as `place_order`. No external crank.
- **Isolated margin** — each position carries its own USDC collateral. No cross-margin in v1.
- **Oracle** — keeper fetches Prestocks token prices from Jupiter Price API and pushes on-chain via `update_price`. TWAP smoothed, max 10% deviation per update. Stale oracle triggers reduce-only → pause.
- **Funding rate** — computed hourly: `(mark − oracle) / oracle × (1/24)`. Settled lazily per position via `settle_funding`.

---

## Devnet program IDs

| Program | Address |
|---|---|
| protoperps | `2B3FDJu1myUaoeXuoWQ7MD8B5r1fr1BbSG4RX9GfHxDr` |
| oracle | `Av4fWEvzFmn1NatYWbQw5HnWKesUfsnKDqwkhau4v7KQ` |

---

## Markets

| Market | Symbol | Underlying |
|---|---|---|
| SpaceX | SPACEX-PERP | SPACEX Prestocks token |
| OpenAI | OPENAI-PERP | OPENAI Prestocks token |
| Anthropic | ANTHRP-PERP | ANTHRP Prestocks token |
| Anduril | ANDURL-PERP | ANDURL Prestocks token |
| xAI | XAI-PERP | xAI Prestocks token |
| Neuralink | NRLNK-PERP | NRLNK Prestocks token *(placeholder)* |
| Kalshi | KALSHI-PERP | Kalshi Prestocks token *(placeholder)* |
