import json
import time

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException
from ..config import settings

router = APIRouter(prefix="/orderbook", tags=["orderbook"])

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _oracle_status(last_ts: float) -> int:
    """0=Active, 1=ReduceOnly, 2=Paused based on seconds since last Pyth update."""
    age = time.time() - last_ts
    if age < 300:    # < 5 min
        return 0
    if age < 900:    # 5–15 min
        return 1
    return 2         # > 15 min


@router.get("/{symbol}")
async def get_orderbook(symbol: str):
    key = f"orderbook:{symbol.upper()}"
    data = await get_redis().get(key)
    if data is None:
        raise HTTPException(status_code=404, detail=f"no orderbook for {symbol}")
    return json.loads(data)


@router.get("/{symbol}/price")
async def get_mark_price(symbol: str):
    sym = symbol.upper()
    r = get_redis()
    price_raw, ts_raw = await r.mget(f"price:{sym}", f"price_ts:{sym}")

    if price_raw is None:
        raise HTTPException(status_code=404, detail=f"no price for {symbol}")

    last_ts = float(ts_raw) if ts_raw else 0.0
    status = _oracle_status(last_ts) if last_ts > 0 else 2

    return {
        "symbol":              sym,
        "price":               int(price_raw),
        "status":              status,
        "last_update_ts":      int(last_ts),
    }
