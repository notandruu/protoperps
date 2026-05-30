import json

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


@router.get("/{symbol}")
async def get_orderbook(symbol: str):
    key = f"orderbook:{symbol.upper()}"
    data = await get_redis().get(key)
    if data is None:
        raise HTTPException(status_code=404, detail=f"no orderbook for {symbol}")
    return json.loads(data)


@router.get("/{symbol}/price")
async def get_mark_price(symbol: str):
    key = f"price:{symbol.upper()}"
    price = await get_redis().get(key)
    if price is None:
        raise HTTPException(status_code=404, detail=f"no price for {symbol}")
    return {"symbol": symbol.upper(), "price": int(price)}
