"""
Momentum strategy.

Tracks a fast and slow EMA of the mark price.
Goes long when fast EMA crosses above slow EMA; short when it crosses below.
Exits when the cross reverses.
"""

import asyncio
import logging
import os

from .base import Strategy

logger = logging.getLogger(__name__)

LOT_PRECISION = 1_000_000


class EMA:
    def __init__(self, period: int):
        self.period = period
        self.value: float | None = None

    def update(self, price: float) -> float:
        if self.value is None:
            self.value = price
        else:
            alpha = 2 / (self.period + 1)
            self.value = alpha * price + (1 - alpha) * self.value
        return self.value


class MomentumFollower(Strategy):
    def __init__(
        self,
        kafka_brokers: str,
        symbols: list[str],
        trader_id: str,
        fast_period: int = 5,
        slow_period: int = 20,
        order_size: int = 1 * LOT_PRECISION,
    ):
        super().__init__("momentum", kafka_brokers, symbols)
        self.trader_id = trader_id
        self.order_size = order_size
        self._fast: dict[str, EMA] = {}
        self._slow: dict[str, EMA] = {}
        self._position: dict[str, str | None] = {}  # None | "long" | "short"

    async def on_market_data(self, event: dict) -> None:
        symbol = event.get("symbol") or event.get("market", "")
        raw_price = event.get("price")
        if not raw_price or not symbol:
            return

        price = float(raw_price) / 1_000_000  # convert from PRICE_PRECISION

        fast = self._fast.setdefault(symbol, EMA(5))
        slow = self._slow.setdefault(symbol, EMA(20))
        fast_val = fast.update(price)
        slow_val = slow.update(price)

        current_pos = self._position.get(symbol)

        if fast_val > slow_val and current_pos != "long":
            if current_pos == "short":
                # Close short first
                await self.emit_order({
                    "type": "place",
                    "trader": self.trader_id,
                    "market": symbol,
                    "side": "long",
                    "order_type": "market",
                    "price": 0,
                    "size": self.order_size,
                })
            await self.emit_order({
                "type": "place",
                "trader": self.trader_id,
                "market": symbol,
                "side": "long",
                "order_type": "market",
                "price": 0,
                "size": self.order_size,
            })
            self._position[symbol] = "long"

        elif fast_val < slow_val and current_pos != "short":
            if current_pos == "long":
                await self.emit_order({
                    "type": "place",
                    "trader": self.trader_id,
                    "market": symbol,
                    "side": "short",
                    "order_type": "market",
                    "price": 0,
                    "size": self.order_size,
                })
            await self.emit_order({
                "type": "place",
                "trader": self.trader_id,
                "market": symbol,
                "side": "short",
                "order_type": "market",
                "price": 0,
                "size": self.order_size,
            })
            self._position[symbol] = "short"

    async def on_fill(self, event: dict) -> None:
        pass  # position tracking via on_market_data signals is sufficient


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    strat = MomentumFollower(
        kafka_brokers=os.getenv("KAFKA_BROKERS", "localhost:9092"),
        symbols=os.getenv("SYMBOLS", "BTCUSDT").split(","),
        trader_id=os.getenv("TRADER_ID", "momentum-default"),
    )
    asyncio.run(strat.run())
