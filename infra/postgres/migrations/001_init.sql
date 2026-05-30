-- Trading Engine — initial schema

CREATE TABLE IF NOT EXISTS positions (
    id          UUID PRIMARY KEY,
    market      TEXT NOT NULL,
    trader      TEXT NOT NULL,
    side        TEXT NOT NULL CHECK (side IN ('Long', 'Short')),
    size        BIGINT NOT NULL DEFAULT 0,
    entry_price BIGINT NOT NULL DEFAULT 0,
    collateral  BIGINT NOT NULL DEFAULT 0,
    last_funding_rate BIGINT NOT NULL DEFAULT 0,
    realized_pnl BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (market, trader)
);

CREATE TABLE IF NOT EXISTS fills (
    id          BIGSERIAL PRIMARY KEY,
    market      TEXT NOT NULL,
    maker       TEXT NOT NULL,
    price       BIGINT NOT NULL,
    size        BIGINT NOT NULL,
    maker_seq   BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pnl_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    trader      TEXT NOT NULL,
    market      TEXT NOT NULL,
    realized_pnl BIGINT NOT NULL,
    unrealized_pnl BIGINT NOT NULL,
    mark_price  BIGINT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fills_market_created ON fills (market, created_at DESC);
CREATE INDEX IF NOT EXISTS fills_maker ON fills (maker, created_at DESC);
CREATE INDEX IF NOT EXISTS positions_trader ON positions (trader);
CREATE INDEX IF NOT EXISTS pnl_trader ON pnl_snapshots (trader, snapshot_at DESC);
