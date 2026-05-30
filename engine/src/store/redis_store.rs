use anyhow::Result;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::Serialize;

pub struct RedisStore {
    conn: ConnectionManager,
}

impl RedisStore {
    pub async fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }

    pub async fn set_orderbook<T: Serialize>(
        &mut self,
        symbol: &str,
        snapshot: &T,
    ) -> Result<()> {
        let key = format!("orderbook:{symbol}");
        let value = serde_json::to_string(snapshot)?;
        // TTL 60s — engine refreshes every second
        self.conn.set_ex::<_, _, ()>(key, value, 60).await?;
        Ok(())
    }

    pub async fn set_mark_price(&mut self, symbol: &str, price: u64) -> Result<()> {
        let key = format!("price:{symbol}");
        self.conn.set_ex::<_, _, ()>(&key, price.to_string(), 1200).await?;
        // Store timestamp so the API can compute staleness / oracle status
        let ts_key = format!("price_ts:{symbol}");
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.conn.set_ex::<_, _, ()>(ts_key, ts.to_string(), 1200).await?;
        Ok(())
    }

    pub async fn set_position<T: Serialize>(
        &mut self,
        trader: &str,
        symbol: &str,
        pos: &T,
    ) -> Result<()> {
        let key = format!("position:{trader}:{symbol}");
        let value = serde_json::to_string(pos)?;
        self.conn.set_ex::<_, _, ()>(key, value, 300).await?;
        Ok(())
    }
}
