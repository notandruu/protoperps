import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..kafka import subscribe, unsubscribe

router = APIRouter(tags=["ws"])


@router.websocket("/ws/orderbook/{symbol}")
async def ws_orderbook(websocket: WebSocket, symbol: str):
    await websocket.accept()
    key = f"book:{symbol.upper()}"
    q = subscribe(key)
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=30.0)
                await websocket.send_json(msg)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        unsubscribe(key, q)
