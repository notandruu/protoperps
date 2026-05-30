use anyhow::{bail, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

use crate::MarketEvent;

// Binance combined stream URL
const WS_URL: &str = "wss://stream.binance.com:9443/stream";

/// Subscribe to Binance public depth + trade streams for the given symbols.
/// Calls `on_event` for every normalized event received.
pub async fn connect(
    symbols: &[&str],
    mut on_event: impl FnMut(MarketEvent),
) -> Result<()> {
    // Build combined stream name, e.g. btcusdt@depth5@100ms/btcusdt@trade
    let streams: Vec<String> = symbols
        .iter()
        .flat_map(|s| {
            let sym = s.to_lowercase();
            vec![
                format!("{sym}@depth5@100ms"),
                format!("{sym}@trade"),
            ]
        })
        .collect();
    let stream_param = streams.join("/");
    let url = format!("{WS_URL}?streams={stream_param}");

    info!("connecting to Binance WS: {url}");
    let (ws, _) = connect_async(&url).await?;
    let (mut write, mut read) = ws.split();

    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                warn!("ws read error: {e}");
                bail!("ws disconnected: {e}");
            }
        };

        if let Message::Text(text) = msg {
            if let Ok(env) = serde_json::from_str::<StreamEnvelope>(&text) {
                match env.data {
                    StreamData::DepthUpdate(d) => {
                        let symbol = stream_symbol(&env.stream);
                        on_event(MarketEvent::Depth {
                            symbol,
                            bids: d.bids.iter()
                                .filter_map(|v| parse_level(v))
                                .collect(),
                            asks: d.asks.iter()
                                .filter_map(|v| parse_level(v))
                                .collect(),
                            timestamp: d.event_time,
                        });
                    }
                    StreamData::Trade(t) => {
                        let symbol = stream_symbol(&env.stream);
                        on_event(MarketEvent::Trade {
                            symbol,
                            price: t.price.parse().unwrap_or(0.0),
                            size: t.qty.parse().unwrap_or(0.0),
                            is_buyer_maker: t.is_buyer_maker,
                            timestamp: t.trade_time,
                        });
                    }
                }
            }
        }
    }
    bail!("ws stream ended")
}

fn stream_symbol(stream: &str) -> String {
    // e.g. "btcusdt@depth5@100ms" → "BTCUSDT"
    stream.split('@').next().unwrap_or("UNKNOWN").to_uppercase()
}

fn parse_level(v: &[serde_json::Value]) -> Option<[f64; 2]> {
    let price = v.get(0)?.as_str()?.parse().ok()?;
    let size = v.get(1)?.as_str()?.parse().ok()?;
    Some([price, size])
}

#[derive(Deserialize)]
struct StreamEnvelope {
    stream: String,
    data: StreamData,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StreamData {
    DepthUpdate(DepthUpdate),
    Trade(TradeEvent),
}

#[derive(Deserialize)]
struct DepthUpdate {
    #[serde(rename = "E")]
    event_time: u64,
    #[serde(rename = "b")]
    bids: Vec<Vec<serde_json::Value>>,
    #[serde(rename = "a")]
    asks: Vec<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct TradeEvent {
    #[serde(rename = "T")]
    trade_time: u64,
    #[serde(rename = "p")]
    price: String,
    #[serde(rename = "q")]
    qty: String,
    #[serde(rename = "m")]
    is_buyer_maker: bool,
}
