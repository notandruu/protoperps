"""Kafka producer + fan-out consumer for the API gateway."""

import asyncio
import json
from typing import Callable

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from .config import settings

TOPIC_ORDERS_IN = "orders.in"
TOPIC_FILLS = "fills"
TOPIC_BOOK = "market_data.book"
TOPIC_PNL = "pnl"
TOPIC_DLQ = "dlq.orders"

# Connected WebSocket clients per topic key: { "fills": [queue, ...], "book:BTCUSDT": [...] }
_subscribers: dict[str, list[asyncio.Queue]] = {}

_producer: AIOKafkaProducer | None = None


async def get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        _producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_brokers,
            value_serializer=lambda v: json.dumps(v).encode(),
            key_serializer=lambda k: k.encode() if k else None,
            acks="all",
        )
        await _producer.start()
    return _producer


async def publish_order(payload: dict) -> None:
    """Publish an order command to orders.in with circuit-breaker protection."""
    from .breaker import kafka_breaker

    async def _send():
        prod = await get_producer()
        await prod.send_and_wait(
            TOPIC_ORDERS_IN,
            value=payload,
            key=payload.get("market"),
        )

    try:
        await kafka_breaker.call_async(_send)
    except Exception:
        # Route to DLQ when breaker is open or send fails
        try:
            prod = await get_producer()
            await prod.send(TOPIC_DLQ, value=payload)
        except Exception:
            pass  # nothing more we can do
        raise


def subscribe(key: str) -> asyncio.Queue:
    """Return a queue that receives messages for the given key."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _subscribers.setdefault(key, []).append(q)
    return q


def unsubscribe(key: str, q: asyncio.Queue) -> None:
    subs = _subscribers.get(key, [])
    try:
        subs.remove(q)
    except ValueError:
        pass


async def _fan_out(key: str, message: dict) -> None:
    dead = []
    for q in _subscribers.get(key, []):
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        unsubscribe(key, q)


async def start_consumers() -> None:
    """Background task: consume fills + orderbook updates and fan out to WS clients."""
    consumer = AIOKafkaConsumer(
        TOPIC_FILLS,
        TOPIC_BOOK,
        bootstrap_servers=settings.kafka_brokers,
        group_id="api-fanout",
        auto_offset_reset="latest",
        value_deserializer=lambda b: json.loads(b),
    )
    await consumer.start()
    try:
        async for msg in consumer:
            data = msg.value
            if msg.topic == TOPIC_FILLS:
                await _fan_out("fills", data)
                # Also fan out to per-trader key
                trader = data.get("taker")
                if trader:
                    await _fan_out(f"fills:{trader}", data)
            elif msg.topic == TOPIC_BOOK:
                symbol = data.get("market", "")
                await _fan_out(f"book:{symbol}", data)
    finally:
        await consumer.stop()
