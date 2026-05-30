mod exchanges;

use std::time::Duration;

use anyhow::Result;
use rdkafka::config::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

const TOPIC_TRADES: &str = "market_data.trades";
const TOPIC_BOOK: &str = "market_data.book";
const DLQ: &str = "dlq.market_data";

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MarketEvent {
    Trade {
        symbol: String,
        price: f64,
        size: f64,
        is_buyer_maker: bool,
        timestamp: u64,
    },
    Depth {
        symbol: String,
        bids: Vec<[f64; 2]>,
        asks: Vec<[f64; 2]>,
        timestamp: u64,
    },
}

impl MarketEvent {
    fn symbol(&self) -> &str {
        match self {
            MarketEvent::Trade { symbol, .. } => symbol,
            MarketEvent::Depth { symbol, .. } => symbol,
        }
    }
    fn topic(&self) -> &str {
        match self {
            MarketEvent::Trade { .. } => TOPIC_TRADES,
            MarketEvent::Depth { .. } => TOPIC_BOOK,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Config {
    kafka_brokers: String,
    symbols: Vec<String>,
    reconnect_delay_ms: Option<u64>,
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

    let symbols: Vec<&str> = cfg.symbols.iter().map(|s| s.as_str()).collect();
    let reconnect_delay = Duration::from_millis(cfg.reconnect_delay_ms.unwrap_or(2000));

    // Circuit breaker state: consecutive failure count
    let mut failure_count: u32 = 0;
    const CB_THRESHOLD: u32 = 5;
    const CB_COOLDOWN_SECS: u64 = 30;

    loop {
        if failure_count >= CB_THRESHOLD {
            warn!(
                "circuit breaker OPEN after {failure_count} failures — \
                 cooling down {CB_COOLDOWN_SECS}s"
            );
            tokio::time::sleep(Duration::from_secs(CB_COOLDOWN_SECS)).await;
            failure_count = 0;
            info!("circuit breaker HALF-OPEN, attempting reconnect");
        }

        let prod_ref = &producer;
        let result = exchanges::binance::connect(&symbols, |event| {
            let topic = event.topic();
            let key = event.symbol().to_string();
            let payload = match serde_json::to_string(&event) {
                Ok(p) => p,
                Err(e) => {
                    warn!("serialize failed: {e}");
                    return;
                }
            };
            let record = FutureRecord::to(topic)
                .payload(payload.as_bytes())
                .key(key.as_bytes());
            // Non-blocking fire-and-forget; real failures tracked by rdkafka delivery report
            let _ = prod_ref.send_result(record);
        })
        .await;

        match result {
            Ok(()) => {
                failure_count = 0;
            }
            Err(e) => {
                failure_count += 1;
                error!("ingestor error (attempt {failure_count}): {e}");
                tokio::time::sleep(reconnect_delay).await;
            }
        }
    }
}
