"""
Market-maker strategy.

Posts symmetric bids and asks around the mark price with a configurable spread.
Cancels stale quotes when the price moves by more than half the spread.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

from .base import Strategy

logger = logging.getLogger(__name__)

PRICE_PRECISION = 1_000_000
LOT_PRECISION   = 1_000_000


@dataclass
class QuoteState:
    bid_seq: int | None = None
    ask_seq: int | None = None
    bid_price: int = 0
    ask_price: int = 0
    last_quote_ts: float = 0.0


class MarketMaker(Strategy):
    """
    Symmetric quote market maker.

    Parameters
    ----------
    spread_bps : int
        Half-spread in basis points. E.g. 5 → bid at -0.05%, ask at +0.05%.
    quote_size : int
        Order size per side in LOT_PRECISION units.
    quote_interval_s : float
        Minimum time between re-quotes.
    """

    def __init__(
        self,
        kafka_brokers: str,
        symbols: list[str],
        trader_id: str,
        spread_bps: int = 5,
        quote_size: int = 1 * LOT_PRECISION,
        quote_interval_s: float = 1.0,
    ):
        super().__init__("market_maker", kafka_brokers, symbols)
        self.trader_id = trader_id
        self.spread_bps = spread_bps
        self.quote_size = quote_size
        self.quote_interval_s = quote_interval_s

        # Per-symbol state
        self._mark: dict[str, int] = {}
        self._quotes: dict[str, QuoteState] = {}

    async def on_market_data(self, event: dict) -> None:
        symbol = event.get("symbol") or event.get("market", "")
        price = event.get("price")
        if price and symbol:
            self._mark[symbol] = int(price)
            await self._maybe_requote(symbol)

    async def on_fill(self, event: dict) -> None:
        # Invalidate cached quote seqs for filled side
        symbol = event.get("market", "")
        q = self._quotes.get(symbol)
        if q and event.get("taker") == self.trader_id:
            q.bid_seq = None
            q.ask_seq = None

    async def _maybe_requote(self, symbol: str) -> None:
        mark = self._mark.get(symbol)
        if not mark:
            return

        q = self._quotes.setdefault(symbol, QuoteState())
        now = time.monotonic()
        if now - q.last_quote_ts < self.quote_interval_s:
            return

        half_spread = mark * self.spread_bps // 10_000
        bid_price = mark - half_spread
        ask_price = mark + half_spread

        # Cancel stale quotes if price moved more than half the spread
        if q.bid_seq is not None and abs(bid_price - q.bid_price) > half_spread:
            await self.emit_order({
                "type": "cancel",
                "trader": self.trader_id,
                "market": symbol,
                "sequence_number": q.bid_seq,
            })
            q.bid_seq = None

        if q.ask_seq is not None and abs(ask_price - q.ask_price) > half_spread:
            await self.emit_order({
                "type": "cancel",
                "trader": self.trader_id,
                "market": symbol,
                "sequence_number": q.ask_seq,
            })
            q.ask_seq = None

        # Post fresh quotes
        if q.bid_seq is None:
            await self.emit_order({
                "type": "place",
                "trader": self.trader_id,
                "market": symbol,
                "side": "long",
                "order_type": "post_only",
                "price": bid_price,
                "size": self.quote_size,
            })

        if q.ask_seq is None:
            await self.emit_order({
                "type": "place",
                "trader": self.trader_id,
                "market": symbol,
                "side": "short",
                "order_type": "post_only",
                "price": ask_price,
                "size": self.quote_size,
            })

        q.bid_price = bid_price
        q.ask_price = ask_price
        q.last_quote_ts = now


if __name__ == "__main__":
    import os
    logging.basicConfig(level=logging.INFO)
    mm = MarketMaker(
        kafka_brokers=os.getenv("KAFKA_BROKERS", "localhost:9092"),
        symbols=os.getenv("SYMBOLS", "BTCUSDT,ETHUSDT").split(","),
        trader_id=os.getenv("TRADER_ID", "mm-default"),
        spread_bps=int(os.getenv("SPREAD_BPS", "5")),
    )
    asyncio.run(mm.run())
