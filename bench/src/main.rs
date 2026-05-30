/// Load generator for the trading engine.
///
/// Publishes synthetic orders to `orders.in` at a configurable rate and
/// measures end-to-end latency (publish time → fill event on `fills`).
///
/// Usage:
///   cargo run --release -p bench -- --rate 10000 --duration 30 --brokers localhost:19092

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use clap::Parser;
use hdrhistogram::Histogram;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "load-gen")]
struct Args {
    #[arg(long, default_value = "localhost:19092")]
    brokers: String,

    /// Target orders per second
    #[arg(long, default_value_t = 10_000)]
    rate: u64,

    /// Duration of the test in seconds
    #[arg(long, default_value_t = 30)]
    duration: u64,

    /// Market symbol
    #[arg(long, default_value = "BTCUSDT")]
    market: String,

    /// Number of simulated traders
    #[arg(long, default_value_t = 100)]
    traders: u64,
}

#[derive(Serialize)]
struct OrderPayload {
    #[serde(rename = "type")]
    kind: &'static str,
    trader: String,
    market: String,
    side: &'static str,
    order_type: &'static str,
    price: u64,
    size: u64,
    bench_ts_us: u64, // microsecond timestamp for latency measurement
}

/// The engine publishes bench_ts_us on FillEvent so we can measure round-trip latency.
#[derive(Deserialize)]
struct FillEvent {
    market: String,
    bench_ts_us: Option<u64>, // echoed back from the order payload
    fills: Vec<FillItem>,
}

#[derive(Deserialize)]
struct FillItem {
    // per-fill fields (price, size, etc.) — we don't need them for latency
    #[allow(dead_code)]
    price: Option<u64>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    info!(
        "load-gen: rate={}/s duration={}s market={} traders={}",
        args.rate, args.duration, args.market, args.traders
    );

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &args.brokers)
        .set("queue.buffering.max.ms", "0")
        .create()?;

    let histogram = Arc::new(Mutex::new(
        Histogram::<u64>::new_with_max(10_000_000, 3)?,
    ));
    let sent = Arc::new(AtomicU64::new(0));
    let fills_received = Arc::new(AtomicU64::new(0));

    // Spawn fill consumer to measure latency
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &args.brokers)
        .set("group.id", "bench-latency")
        .set("auto.offset.reset", "latest")
        .create()?;
    consumer.subscribe(&["fills"])?;

    let hist_rx = histogram.clone();
    let fills_rx = fills_received.clone();
    tokio::spawn(async move {
        loop {
            match consumer.recv().await {
                Ok(msg) => {
                    if let Some(p) = msg.payload() {
                        if let Ok(fe) = serde_json::from_slice::<FillEvent>(p) {
                            // bench_ts_us is echoed from the original order so we get
                            // full round-trip latency: produce → engine → fills topic → consumer
                            if let Some(sent_us) = fe.bench_ts_us {
                                let now_us = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap()
                                    .as_micros() as u64;
                                let latency_us = now_us.saturating_sub(sent_us);
                                let mut h = hist_rx.lock().await;
                                let _ = h.record(latency_us);
                                fills_rx.fetch_add(fe.fills.len() as u64, Ordering::Relaxed);
                            }
                        }
                    }
                }
                Err(e) => warn!("fill consumer error: {e}"),
            }
        }
    });

    // ── Send loop ─────────────────────────────────────────────────────────────
    // rate=0 → burst mode: no sleep, saturate the broker as fast as possible.
    let interval_us = if args.rate == 0 { 0 } else { 1_000_000 / args.rate };
    let end = Instant::now() + Duration::from_secs(args.duration);
    let mut order_seq: u64 = 0;

    // Alternating aggressive bid/ask around a simulated $65,000 price.
    // Longs buy at mid+1 (cross against any resting ask ≤ mid+1).
    // Shorts sell at mid-1 (cross against any resting bid ≥ mid-1).
    // Pattern: each short immediately matches the preceding long's resting bid.
    let base_price: u64 = 65_000 * 1_000_000;

    while Instant::now() < end {
        let trader = format!("bench-trader-{}", order_seq % args.traders);
        let side = if order_seq % 2 == 0 { "long" } else { "short" };
        let price = if side == "long" {
            base_price + 1_000_000 // $1 above mid — aggressive buy, rests as bid
        } else {
            base_price - 1_000_000 // $1 below mid — aggressive sell, crosses resting bids
        };

        let now_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_micros() as u64;

        let payload = OrderPayload {
            kind: "place",
            trader,
            market: args.market.clone(),
            side,
            order_type: "limit",
            price,
            size: 1_000_000, // 1 unit
            bench_ts_us: now_us,
        };

        let body = serde_json::to_string(&payload)?;
        let record = FutureRecord::to("orders.in")
            .payload(body.as_bytes())
            .key(args.market.as_bytes());
        let _ = producer.send_result(record);
        sent.fetch_add(1, Ordering::Relaxed);
        order_seq += 1;

        if interval_us > 0 {
            tokio::time::sleep(Duration::from_micros(interval_us)).await;
        } else {
            tokio::task::yield_now().await; // cooperate without blocking
        }
    }

    // Wait a bit for fills to come back
    tokio::time::sleep(Duration::from_secs(2)).await;

    // ── Report ─────────────────────────────────────────────────────────────────
    let total_sent = sent.load(Ordering::Relaxed);
    let total_fills = fills_received.load(Ordering::Relaxed);
    let h = histogram.lock().await;

    println!("\n=== Benchmark Results ===");
    println!("Duration:      {}s", args.duration);
    println!("Orders sent:   {total_sent}");
    println!("Fills received: {total_fills}");
    println!(
        "Throughput:    {:.0} orders/sec",
        total_sent as f64 / args.duration as f64
    );
    if h.len() > 0 {
        println!("\nEnd-to-end latency (publish → fill event):");
        println!("  p50:  {} µs  ({:.2} ms)", h.value_at_quantile(0.50), h.value_at_quantile(0.50) as f64 / 1000.0);
        println!("  p90:  {} µs  ({:.2} ms)", h.value_at_quantile(0.90), h.value_at_quantile(0.90) as f64 / 1000.0);
        println!("  p99:  {} µs  ({:.2} ms)", h.value_at_quantile(0.99), h.value_at_quantile(0.99) as f64 / 1000.0);
        println!("  p999: {} µs  ({:.2} ms)", h.value_at_quantile(0.999), h.value_at_quantile(0.999) as f64 / 1000.0);
        println!("  max:  {} µs  ({:.2} ms)", h.max(), h.max() as f64 / 1000.0);
    }

    Ok(())
}
