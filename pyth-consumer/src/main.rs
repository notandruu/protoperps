use std::collections::HashMap;
use std::time::Duration;

use anyhow::{bail, Result};
use futures_util::StreamExt;
use rdkafka::config::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

const HERMES_SSE: &str = "https://hermes.pyth.network/v2/updates/price/stream";
const TOPIC_PYTH: &str = "market_data.pyth";
const DLQ: &str = "dlq.market_data";

// ── Precision constants (matches engine) ─────────────────────────────────────
const PRICE_PRECISION: u64 = 1_000_000;
const DEVIATION_GUARD_BPS: u64 = 1_000; // ±10%

// ── Pyth feed IDs ─────────────────────────────────────────────────────────────
fn default_feeds() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert(
        "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        "BTCUSDT",
    );
    m.insert(
        "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        "ETHUSDT",
    );
    m.insert(
        "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        "SOLUSDT",
    );
    m
}

#[derive(Debug, Deserialize)]
struct Config {
    kafka_brokers: String,
    reconnect_delay_ms: Option<u64>,
}

// ── Output event to Kafka ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PythPriceEvent {
    pub symbol: String,
    pub price: u64,            // PRICE_PRECISION units
    pub confidence: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub timestamp: i64,
}

// ── TWAP state per symbol ─────────────────────────────────────────────────────

struct TwapState {
    twap: u64,
    samples: u64,
    previous_price: u64,
}

impl TwapState {
    fn new(initial: u64) -> Self {
        TwapState { twap: initial, samples: 1, previous_price: initial }
    }

    fn update(&mut self, new_price: u64) -> Option<u64> {
        // Deviation guard: reject if |new - previous| / previous > 10%
        if self.previous_price > 0 {
            let diff = (new_price as i128 - self.previous_price as i128).unsigned_abs() as u64;
            if diff.saturating_mul(10_000) > self.previous_price.saturating_mul(DEVIATION_GUARD_BPS) {
                warn!(
                    "pyth price deviation too large: prev={} new={} diff={}",
                    self.previous_price, new_price, diff
                );
                return None;
            }
        }

        // EMA TWAP: alpha = 1 / min(samples, 100)
        let n = self.samples.min(100);
        self.twap = self.twap + (new_price.saturating_sub(self.twap)) / n;
        self.samples += 1;
        self.previous_price = new_price;
        Some(new_price)
    }
}

// ── Hermes SSE response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct HermesUpdate {
    parsed: Option<Vec<ParsedPrice>>,
}

#[derive(Deserialize)]
struct ParsedPrice {
    id: String,
    price: PriceData,
    metadata: Option<PriceMeta>,
}

#[derive(Deserialize)]
struct PriceData {
    price: String,
    conf: String,
    expo: i32,
    publish_time: i64,
}

#[derive(Deserialize)]
struct PriceMeta {
    slot: Option<u64>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let cfg: Config = config::Config::builder()
        .add_source(config::Environment::default().separator("__"))
        .build()?
        .try_deserialize()?;

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &cfg.kafka_brokers)
        .set("message.timeout.ms", "5000")
        .create()?;

    let feeds = default_feeds();
    let ids: Vec<&str> = feeds.keys().copied().collect();
    let reconnect_delay = Duration::from_millis(cfg.reconnect_delay_ms.unwrap_or(3000));

    let mut twap_states: HashMap<String, TwapState> = HashMap::new();
    let mut failure_count: u32 = 0;
    const CB_THRESHOLD: u32 = 5;

    loop {
        if failure_count >= CB_THRESHOLD {
            warn!("pyth circuit breaker OPEN — cooling down 30s");
            tokio::time::sleep(Duration::from_secs(30)).await;
            failure_count = 0;
        }

        match run_stream(&cfg, &producer, &feeds, &ids, &mut twap_states).await {
            Ok(()) => { failure_count = 0; }
            Err(e) => {
                failure_count += 1;
                error!("pyth stream error (attempt {failure_count}): {e}");
                tokio::time::sleep(reconnect_delay).await;
            }
        }
    }
}

async fn run_stream(
    cfg: &Config,
    producer: &FutureProducer,
    feeds: &HashMap<&str, &str>,
    ids: &[&str],
    twap_states: &mut HashMap<String, TwapState>,
) -> Result<()> {
    let ids_param = ids.iter().map(|id| format!("ids[]={id}")).collect::<Vec<_>>().join("&");
    let url = format!("{HERMES_SSE}?{ids_param}&encoding=json&parsed=true");

    info!("connecting to Pyth Hermes SSE");
    let client = reqwest::Client::new();
    let mut stream = client.get(&url).send().await?.bytes_stream();

    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // SSE frames are separated by double newlines
        while let Some(pos) = buf.find("\n\n") {
            let frame = buf[..pos].to_string();
            buf = buf[pos + 2..].to_string();

            for line in frame.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(update) = serde_json::from_str::<HermesUpdate>(data) {
                        if let Some(parsed) = update.parsed {
                            for p in parsed {
                                let symbol = match feeds.get(p.id.as_str()) {
                                    Some(s) => s.to_string(),
                                    None => continue,
                                };

                                // Scale price to PRICE_PRECISION
                                let raw: i64 = p.price.price.parse().unwrap_or(0);
                                let scaled = scale_price(raw, p.price.expo);
                                if scaled == 0 { continue; }

                                let state = twap_states
                                    .entry(symbol.clone())
                                    .or_insert_with(|| TwapState::new(scaled));

                                let price = match state.update(scaled) {
                                    Some(p) => p,
                                    None => continue, // deviation guard rejected
                                };

                                let conf_raw: u64 = p.price.conf.parse().unwrap_or(0);
                                let confidence = scale_price(conf_raw as i64, p.price.expo);

                                let now = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs() as i64;

                                let event = PythPriceEvent {
                                    symbol: symbol.clone(),
                                    price,
                                    confidence,
                                    expo: p.price.expo,
                                    publish_time: p.price.publish_time,
                                    timestamp: now,
                                };

                                let payload = serde_json::to_string(&event)?;
                                let record = FutureRecord::to(TOPIC_PYTH)
                                    .payload(payload.as_bytes())
                                    .key(symbol.as_bytes());
                                let _ = producer.send_result(record);

                                info!("pyth {symbol}: price={price} conf={confidence}");
                            }
                        }
                    }
                }
            }
        }
    }
    bail!("pyth SSE stream ended")
}

/// Scale a Pyth price (raw integer + exponent) to PRICE_PRECISION units.
///
/// Pyth prices have exponents like -8, meaning the value is raw * 10^-8.
/// We want the result in units of PRICE_PRECISION (10^6).
fn scale_price(raw: i64, expo: i32) -> u64 {
    if raw <= 0 { return 0; }
    // target_expo = -6 (PRICE_PRECISION = 10^6)
    let shift = expo - (-6i32); // positive = raw is in larger units
    let scaled = if shift >= 0 {
        (raw as u64).saturating_mul(10u64.pow(shift as u32))
    } else {
        let divisor = 10u64.pow((-shift) as u32);
        (raw as u64) / divisor
    };
    scaled
}
