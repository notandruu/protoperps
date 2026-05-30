"""Base strategy class consumed by all strategy workers."""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

logger = logging.getLogger(__name__)

TOPIC_ORDERS_IN = "orders.in"
TOPIC_TRADES = "market_data.trades"
TOPIC_BOOK = "market_data.book"
TOPIC_PYTH = "market_data.pyth"
TOPIC_FILLS = "fills"
TOPIC_DLQ = "dlq.orders"


class Strategy(ABC):
    """
    Base class for all strategy workers.

    Subclasses implement `on_market_data` and `on_fill`.
    The base class handles Kafka plumbing, DLQ routing, and graceful shutdown.
    """

    def __init__(self, name: str, kafka_brokers: str, symbols: list[str]):
        self.name = name
        self.kafka_brokers = kafka_brokers
        self.symbols = symbols
        self._producer: AIOKafkaProducer | None = None
        self._running = False

    # ── Abstract interface ────────────────────────────────────────────────────

    @abstractmethod
    async def on_market_data(self, event: dict) -> None:
        """Called for every market_data.* event. Emit orders via self.emit_order."""
        ...

    @abstractmethod
    async def on_fill(self, event: dict) -> None:
        """Called for every fill that matches our trader ID."""
        ...

    # ── Order emission ────────────────────────────────────────────────────────

    async def emit_order(self, payload: dict) -> None:
        """Publish an order to orders.in. Routes to DLQ on failure."""
        if self._producer is None:
            logger.error("producer not started")
            return
        try:
            await self._producer.send_and_wait(
                TOPIC_ORDERS_IN,
                value=json.dumps(payload).encode(),
                key=(payload.get("market") or "").encode(),
            )
        except Exception as e:
            logger.warning(f"order publish failed: {e}; routing to DLQ")
            try:
                await self._producer.send(
                    TOPIC_DLQ,
                    value=json.dumps(payload).encode(),
                )
            except Exception:
                pass

    # ── Main run loop ─────────────────────────────────────────────────────────

    async def run(self) -> None:
        self._producer = AIOKafkaProducer(bootstrap_servers=self.kafka_brokers)
        consumer = AIOKafkaConsumer(
            TOPIC_BOOK,
            TOPIC_TRADES,
            TOPIC_PYTH,
            TOPIC_FILLS,
            bootstrap_servers=self.kafka_brokers,
            group_id=f"strategy-{self.name}",
            auto_offset_reset="latest",
            value_deserializer=lambda b: json.loads(b),
        )

        await self._producer.start()
        await consumer.start()
        self._running = True
        logger.info(f"strategy {self.name!r} started")

        try:
            async for msg in consumer:
                if not self._running:
                    break
                try:
                    if msg.topic in (TOPIC_BOOK, TOPIC_TRADES, TOPIC_PYTH):
                        # Filter to symbols we care about
                        symbol = msg.value.get("symbol") or msg.value.get("market", "")
                        if not self.symbols or symbol in self.symbols:
                            await self.on_market_data(msg.value)
                    elif msg.topic == TOPIC_FILLS:
                        await self.on_fill(msg.value)
                except Exception as e:
                    logger.error(f"strategy error processing {msg.topic}: {e}")
        finally:
            await consumer.stop()
            await self._producer.stop()

    def stop(self) -> None:
        self._running = False
