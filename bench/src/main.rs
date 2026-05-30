/// Load generator for the trading engine.
///
/// Publishes synthetic orders to `orders.in` at a configurable rate and
/// measures end-to-end latency (publish time → fill event on `fills`).
///
/// Key design decisions vs the naive per-message-sleep approach:
///
///   1. Batch-per-tick: fires a 1 ms tokio interval and sends (rate/1000)
///      messages per tick.  Linux reliably delivers 1 ms intervals; trying
///      to sleep for 100 µs per message at 10 K/s just gives ~1 K/s because
///      the kernel timer floor is ~1 ms.
///
///   2. Producer batching: queue.buffering.max.ms=2 lets librdkafka accumulate
///      a full tick's worth of messages into one network round-trip instead of
///      one syscall per message, which halves Redpanda's CPU load.
///
///   3. rate=0 → burst mode (no tick, saturate broker — for raw throughput
///      measurement only; latency numbers are meaningless in this mode).
///
/// Usage:
///   cargo run --release -p bench -- --rate 10000 --duration 60 --brokers localhost:19092

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
use tokio::time::MissedTickBehavior;
use tracing::{info, warn};

#[derive(Parser, Debug)]
#[command(name = "load-gen")]
struct Args {
    #[arg(long, default_value = "localhost:19092")]
    brokers: String,

    /// Target orders per second (0 = burst mode, no rate limit)
    #[arg(long, default_value_t = 10_000)]
    rate: u64,

    /// Duration of the test in seconds
    #[arg(long, default_value_t = 60)]
    duration: u64,

    /// Market symbol
    #[arg(long, default_value = "BTCUSDT")]
    market: String,

    /// Number of simulated traders
    #[arg(long, default_value_t = 200)]
    traders: u64,
}

#[derive(Serialize)]
struct OrderPayload<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    trader: String,
    market: &'a str,
    side: &'static str,
    order_type: &'static str,
    price: u64,
    size: u64,
    bench_ts_us: u64,
}

#[derive(Deserialize)]
struct FillEvent {
    #[allow(dead_code)]
    market: String,
    bench_ts_us: Option<u64>,
    fills: Vec<serde_json::Value>,
}

#[inline]
fn now_us() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as u64
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    let burst = args.rate == 0;
    // Tick interval and orders-per-tick are derived from the target rate:
    //   rate >= 1000: tick every 1ms, send (rate/1000) orders per tick
    //   rate <  1000: tick every (1000/rate)ms, send 1 order per tick
    // This supports sub-1000/s rates without fractional-ms sleeps.
    let (tick_ms, orders_per_tick): (u64, u64) = if burst {
        (1, 0)
    } else if args.rate >= 1000 {
        (1, (args.rate / 1000).max(1))
    } else {
        ((1000 / args.rate).max(1), 1)
    };
    let effective_rate = if burst { 0 } else { orders_per_tick * (1000 / tick_ms) };

    info!(
        "load-gen: target={}/s tick={}ms orders_per_tick={} duration={}s market={} traders={} burst={}",
        args.rate, tick_ms, orders_per_tick, args.duration, args.market, args.traders, burst
    );

    // ── Producer — batching config ─────────────────────────────────────────────
    // queue.buffering.max.ms=2: accumulate up to 2 ms of messages into one
    // Redpanda batch, cutting the number of network round-trips by ~10–20×
    // at 10 K/s compared to flushing after every single message.
    // linger.ms is the Kafka-standard alias; rdkafka uses the librdkafka name.
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &args.brokers)
        .set("queue.buffering.max.ms", "2")
        .set("queue.buffering.max.messages", "500000")
        .set("batch.num.messages", "1000")
        .set("message.timeout.ms", "10000")
        .create()?;

    // ── HDR histogram — 60 s max latency window ───────────────────────────────
    let histogram = Arc::new(Mutex::new(
        Histogram::<u64>::new_with_max(60_000_000, 3)?,
    ));
    let sent = Arc::new(AtomicU64::new(0));
    let fills_received = Arc::new(AtomicU64::new(0));

    // ── Fill consumer ─────────────────────────────────────────────────────────
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &args.brokers)
        .set("group.id", "bench-latency")
        .set("auto.offset.reset", "latest")
        .set("fetch.min.bytes", "1")
        .set("fetch.wait.max.ms", "1")
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
                            if let Some(sent_ts) = fe.bench_ts_us {
                                let latency_us = now_us().saturating_sub(sent_ts);
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
    // Alternating aggressive bid/ask so every other order crosses and fills.
    // Long  at mid+$1 → rests as bid if no ask present.
    // Short at mid-$1 → crosses the resting bid → FILL.
    let base_price: u64 = 65_000 * 1_000_000; // $65,000 in PRICE_PRECISION units
    let end = Instant::now() + Duration::from_secs(args.duration);
    let mut order_seq: u64 = 0;

    if burst {
        // ── Burst mode: yield between sends, no rate limiting ─────────────────
        while Instant::now() < end {
            send_order(&producer, &args.market, order_seq, args.traders, base_price);
            sent.fetch_add(1, Ordering::Relaxed);
            order_seq += 1;
            tokio::task::yield_now().await;
        }
    } else {
        // ── Batch-per-tick: variable interval, N orders per tick ─────────────
        // MissedTickBehavior::Skip: if a tick fires late (e.g. OS scheduling
        // jitter), skip the missed ticks rather than catching up with a burst.
        let mut interval = tokio::time::interval(Duration::from_millis(tick_ms));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

        while Instant::now() < end {
            interval.tick().await;
            let tick_ts = now_us(); // single timestamp for the whole tick batch
            for _ in 0..orders_per_tick {
                send_order_ts(&producer, &args.market, order_seq, args.traders, base_price, tick_ts);
                sent.fetch_add(1, Ordering::Relaxed);
                order_seq += 1;
            }
        }
    }

    // Drain fill events for up to 3 s after the send loop ends
    tokio::time::sleep(Duration::from_secs(3)).await;

    // ── Report ─────────────────────────────────────────────────────────────────
    let elapsed = args.duration as f64;
    let total_sent = sent.load(Ordering::Relaxed);
    let total_fills = fills_received.load(Ordering::Relaxed);
    let h = histogram.lock().await;

    println!("\n=== Benchmark Results ===");
    if !burst {
        println!("Target rate:    {}/s  (tick={}ms × {}/tick = effective {}/s)", args.rate, tick_ms, orders_per_tick, effective_rate);
    }
    println!("Duration:       {}s", args.duration);
    println!("Orders sent:    {total_sent}");
    println!("Fills received: {total_fills}");
    println!(
        "Throughput:     {:.0} orders/sec  ({:.1}% of target)",
        total_sent as f64 / elapsed,
        (total_sent as f64 / elapsed) / effective_rate as f64 * 100.0,
    );

    if h.len() > 0 {
        println!("\nEnd-to-end latency (publish → fill Kafka event):");
        println!("  p50:  {:>7} µs  ({:.2} ms)", h.value_at_quantile(0.50), h.value_at_quantile(0.50) as f64 / 1000.0);
        println!("  p90:  {:>7} µs  ({:.2} ms)", h.value_at_quantile(0.90), h.value_at_quantile(0.90) as f64 / 1000.0);
        println!("  p99:  {:>7} µs  ({:.2} ms)", h.value_at_quantile(0.99), h.value_at_quantile(0.99) as f64 / 1000.0);
        println!("  p999: {:>7} µs  ({:.2} ms)", h.value_at_quantile(0.999), h.value_at_quantile(0.999) as f64 / 1000.0);
        println!("  max:  {:>7} µs  ({:.2} ms)", h.max(), h.max() as f64 / 1000.0);
    } else {
        println!("\n(no fill events received — check engine logs)");
    }

    Ok(())
}

fn make_payload(market: &str, order_seq: u64, traders: u64, base_price: u64, ts_us: u64) -> String {
    let side = if order_seq % 2 == 0 { "long" } else { "short" };
    let price = if side == "long" {
        base_price + 1_000_000
    } else {
        base_price - 1_000_000
    };
    let payload = OrderPayload {
        kind: "place",
        trader: format!("bench-trader-{}", order_seq % traders),
        market,
        side,
        order_type: "limit",
        price,
        size: 1_000_000,
        bench_ts_us: ts_us,
    };
    serde_json::to_string(&payload).unwrap()
}

fn send_order(producer: &FutureProducer, market: &str, order_seq: u64, traders: u64, base_price: u64) {
    send_order_ts(producer, market, order_seq, traders, base_price, now_us());
}

fn send_order_ts(producer: &FutureProducer, market: &str, order_seq: u64, traders: u64, base_price: u64, ts_us: u64) {
    let body = make_payload(market, order_seq, traders, base_price, ts_us);
    let record = FutureRecord::to("orders.in")
        .payload(body.as_bytes())
        .key(market.as_bytes());
    let _ = producer.send_result(record);
}
