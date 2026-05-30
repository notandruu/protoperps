use anyhow::Result;
use rdkafka::config::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde::Serialize;
use std::time::Duration;
use tracing::warn;

pub struct KafkaProducer {
    inner: FutureProducer,
}

impl KafkaProducer {
    pub fn new(brokers: &str) -> Result<Self> {
        let inner = ClientConfig::new()
            .set("bootstrap.servers", brokers)
            .set("message.timeout.ms", "5000")
            .set("queue.buffering.max.ms", "1")
            .create()?;
        Ok(Self { inner })
    }

    pub async fn send<T: Serialize>(&self, topic: &str, key: &str, payload: &T) -> Result<()> {
        let body = serde_json::to_string(payload)?;
        let record = FutureRecord::to(topic).payload(body.as_bytes()).key(key);
        self.inner
            .send(record, Duration::from_secs(5))
            .await
            .map_err(|(e, _)| anyhow::anyhow!("kafka send failed: {e}"))?;
        Ok(())
    }

    /// Fire-and-forget send that routes to DLQ on failure instead of propagating.
    pub async fn send_or_dlq<T: Serialize>(
        &self,
        topic: &str,
        dlq: &str,
        key: &str,
        payload: &T,
    ) {
        if let Err(e) = self.send(topic, key, payload).await {
            warn!("send to {topic} failed ({e}); routing to DLQ {dlq}");
            let _ = self.send(dlq, key, payload).await;
        }
    }
}
