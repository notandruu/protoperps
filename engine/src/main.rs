mod errors;
mod kafka;
mod matching;
mod math;
mod state;
mod store;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use rdkafka::consumer::Consumer;
use rdkafka::message::Message;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};

use kafka::producer::KafkaProducer;
use kafka::topics::*;
use matching::place_order::{place_order, Fill, PlaceOrderParams};
use state::margin::MarginAccount;
use state::market::Market;
use state::position::Position;
use store::postgres::PgStore;
use store::redis_store::RedisStore;

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct Config {
    kafka_brokers: String,
    redis_url: String,
    database_url: String,
    /// Comma-separated list of market symbols, e.g. "BTCUSDT,ETHUSDT"
    #[serde(deserialize_with = "deserialize_markets")]
    markets: Vec<String>,
    /// Initial USDC balance (in micro-USDC) given to every new margin account.
    /// Set to a large value (e.g. 1_000_000_000_000) for bench/dev environments.
    /// Defaults to 0 (production: accounts must be funded via deposit flow).
    #[serde(default)]
    initial_margin: u64,
}

fn deserialize_markets<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    // Try as a sequence first (JSON array), then fall back to comma-split string.
    struct MarketsVisitor;
    impl<'de> serde::de::Visitor<'de> for MarketsVisitor {
        type Value = Vec<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "a comma-separated string or sequence of market symbols")
        }
        fn visit_str<E: Error>(self, v: &str) -> Result<Vec<String>, E> {
            Ok(v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        }
        fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<String>, A::Error> {
            let mut v = Vec::new();
            while let Some(s) = seq.next_element::<String>()? { v.push(s); }
            Ok(v)
        }
    }
    deserializer.deserialize_any(MarketsVisitor)
}

// ── Kafka message types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OrderCommand {
    Place(PlaceOrderParams),
    Cancel { trader: String, market: String, sequence_number: u64 },
}

#[derive(Debug, Serialize)]
struct FillEvent {
    market: String,
    taker: String,
    fills: Vec<Fill>,
    filled_size: u64,
    remaining_size: u64,
    resting_seq: Option<u64>,
    timestamp: i64,
    /// Echoed back from the order for bench latency measurement; None in production traffic.
    #[serde(skip_serializing_if = "Option::is_none")]
    bench_ts_us: Option<u64>,
}

#[derive(Debug, Serialize)]
struct OrderbookSnapshot {
    market: String,
    bids: Vec<[u64; 2]>, // [price, size]
    asks: Vec<[u64; 2]>,
    timestamp: i64,
}

// ── Per-market state ───────────────────────────────────────────────────────────

struct MarketState {
    market: Market,
    positions: HashMap<String, Position>,
    margins: HashMap<String, MarginAccount>,
    initial_margin: u64,
}

impl MarketState {
    fn new(symbol: &str, initial_margin: u64) -> Self {
        Self {
            market: Market::new(symbol),
            positions: HashMap::new(),
            margins: HashMap::new(),
            initial_margin,
        }
    }

    fn ensure_margin(&mut self, trader: &str) -> &mut MarginAccount {
        let initial = self.initial_margin;
        self.margins
            .entry(trader.to_string())
            .or_insert_with(|| {
                let mut m = MarginAccount::new(trader);
                m.usdc_deposited = initial;
                m
            })
    }

    fn ensure_position(&mut self, trader: &str, symbol: &str) -> &mut Position {
        let cfr = self.market.cumulative_funding_rate;
        let side = crate::state::enums::Side::Long; // will be overwritten on first fill
        self.positions
            .entry(trader.to_string())
            .or_insert_with(|| Position::new(symbol, trader, side, cfr))
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let cfg: Config = config::Config::builder()
        .add_source(config::Environment::default().separator("__").list_separator(","))
        .build()?
        .try_deserialize()?;

    info!("engine starting, markets: {:?}", cfg.markets);

    // Shared state: one RwLock<MarketState> per symbol
    let initial_margin = cfg.initial_margin;
    let states: Arc<HashMap<String, Arc<RwLock<MarketState>>>> = Arc::new(
        cfg.markets
            .iter()
            .map(|s| (s.clone(), Arc::new(RwLock::new(MarketState::new(s, initial_margin)))))
            .collect(),
    );

    let producer = Arc::new(KafkaProducer::new(&cfg.kafka_brokers)?);
    let pg = Arc::new(PgStore::new(&cfg.database_url).await?);
    let redis = Arc::new(tokio::sync::Mutex::new(
        RedisStore::new(&cfg.redis_url).await?,
    ));

    // ── Kafka consumer: orders.in ──────────────────────────────────────────────
    let consumer = kafka::consumer::build_consumer(
        &cfg.kafka_brokers,
        "engine-orders",
        &[ORDERS_IN],
    )?;

    // ── Kafka consumer: market_data.pyth (mark price updates) ─────────────────
    let pyth_consumer = kafka::consumer::build_consumer(
        &cfg.kafka_brokers,
        "engine-pyth",
        &[MARKET_DATA_PYTH],
    )?;

    // Spawn pyth consumer task
    let states_pyth = states.clone();
    let redis_pyth = redis.clone();
    tokio::spawn(async move {
        loop {
            match pyth_consumer.recv().await {
                Ok(msg) => {
                    if let Some(payload) = msg.payload() {
                        if let Ok(update) =
                            serde_json::from_slice::<PythUpdate>(payload)
                        {
                            if let Some(state) = states_pyth.get(&update.symbol) {
                                let mut st = state.write().await;
                                st.market.mark_price = update.price;
                                st.market.mark_price_updated_at = update.timestamp;
                            }
                            let _ = redis_pyth
                                .lock()
                                .await
                                .set_mark_price(&update.symbol, update.price)
                                .await;
                        }
                    }
                }
                Err(e) => warn!("pyth consumer error: {e}"),
            }
        }
    });

    // ── Orderbook snapshot publisher (every 500ms) ─────────────────────────────
    let states_snap = states.clone();
    let prod_snap = producer.clone();
    let redis_snap = redis.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
        loop {
            interval.tick().await;
            let now = now_ts();
            for (symbol, state) in states_snap.iter() {
                let st = state.read().await;
                let snap = OrderbookSnapshot {
                    market: symbol.clone(),
                    bids: (0..st.market.num_bids)
                        .map(|i| [st.market.bids[i].price, st.market.bids[i].size])
                        .collect(),
                    asks: (0..st.market.num_asks)
                        .map(|i| [st.market.asks[i].price, st.market.asks[i].size])
                        .collect(),
                    timestamp: now,
                };
                drop(st);
                let _ = prod_snap.send(ORDERBOOK_UPDATES, symbol, &snap).await;
                let _ = redis_snap.lock().await.set_orderbook(symbol, &snap).await;
            }
        }
    });

    // ── Main order processing loop ─────────────────────────────────────────────
    info!("engine ready, consuming {ORDERS_IN}");
    loop {
        let msg = match consumer.recv().await {
            Ok(m) => m,
            Err(e) => {
                error!("consumer error: {e}");
                continue;
            }
        };

        let payload = match msg.payload() {
            Some(p) => p,
            None => continue,
        };

        let cmd: OrderCommand = match serde_json::from_slice(payload) {
            Ok(c) => c,
            Err(e) => {
                warn!("invalid order command: {e}; routing to DLQ");
                // Send raw bytes (as lossy UTF-8) directly to DLQ — do NOT republish
                // to ORDERS_IN or the engine will loop forever consuming its own errors.
                let _ = producer.send(DLQ_ORDERS, "parse_error", &String::from_utf8_lossy(payload).to_string()).await;
                continue;
            }
        };

        match cmd {
            OrderCommand::Place(params) => {
                let symbol = params.market.clone();
                let state_lock = match states.get(&symbol) {
                    Some(s) => s.clone(),
                    None => {
                        warn!("unknown market {symbol}");
                        continue;
                    }
                };

                let mut st = state_lock.write().await;
                let trader = params.trader.clone();
                st.ensure_margin(&trader);
                st.ensure_position(&trader, &symbol);

                // Split-borrow the separate fields of MarketState so the borrow
                // checker can see they are independent.
                let MarketState { ref mut market, ref mut margins, ref mut positions, .. } = *st;
                let margin = margins.get_mut(&trader).unwrap();
                let position = positions.get_mut(&trader).unwrap();
                let mut maker_positions: HashMap<String, Position> = HashMap::new();

                let result = place_order(&params, market, margin, position, &mut maker_positions);

                match result {
                    Ok(r) => {
                        if !r.fills.is_empty() {
                            let event = FillEvent {
                                market: symbol.clone(),
                                taker: trader.clone(),
                                fills: r.fills.clone(),
                                filled_size: r.filled_size,
                                remaining_size: r.remaining_size,
                                resting_seq: r.resting_seq,
                                timestamp: now_ts(),
                                bench_ts_us: params.bench_ts_us,
                            };

                            // Publish fill event
                            producer
                                .send_or_dlq(FILLS, DLQ_FILLS, &symbol, &event)
                                .await;

                            // Persist to Postgres (fire-and-forget)
                            let pg_clone = pg.clone();
                            let sym_clone = symbol.clone();
                            let fills_clone = r.fills.clone();
                            let pos_clone = position.clone();
                            tokio::spawn(async move {
                                if let Err(e) = pg_clone.insert_fills(&sym_clone, &fills_clone).await {
                                    error!("pg insert_fills failed: {e}");
                                }
                                if let Err(e) = pg_clone.upsert_position(&pos_clone).await {
                                    error!("pg upsert_position failed: {e}");
                                }
                            });

                            // Update Redis position cache
                            let redis_clone = redis.clone();
                            let pos_snap = position.clone();
                            let trader_clone = trader.clone();
                            let sym_clone2 = symbol.clone();
                            tokio::spawn(async move {
                                let _ = redis_clone
                                    .lock()
                                    .await
                                    .set_position(&trader_clone, &sym_clone2, &pos_snap)
                                    .await;
                            });
                        }
                        info!("order processed: market={symbol} trader={trader} fills={}", r.fills.len());
                    }
                    Err(e) => {
                        warn!("order rejected: {e}");
                        // Route the original raw params to DLQ — never back to ORDERS_IN.
                        let _ = producer.send(DLQ_ORDERS, &symbol, &params).await;
                    }
                }
            }

            OrderCommand::Cancel { trader, market, sequence_number } => {
                let state_lock = match states.get(&market) {
                    Some(s) => s.clone(),
                    None => continue,
                };
                let mut st = state_lock.write().await;
                match matching::cancel_order(&mut st.market, &trader, sequence_number) {
                    Ok(freed) => info!("cancel ok: {market} seq={sequence_number} freed={freed}"),
                    Err(e) => warn!("cancel failed: {e}"),
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct PythUpdate {
    symbol: String,
    price: u64,
    timestamp: i64,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
