use anyhow::Result;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::message::Message;
use std::time::Duration;

pub fn build_consumer(brokers: &str, group_id: &str, topics: &[&str]) -> Result<StreamConsumer> {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .set("group.id", group_id)
        .set("auto.offset.reset", "latest")
        .set("enable.auto.commit", "true")
        .set("session.timeout.ms", "30000")
        .create()?;
    consumer.subscribe(topics)?;
    Ok(consumer)
}
