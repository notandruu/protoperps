import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..kafka import subscribe, unsubscribe

router = APIRouter(tags=["ws"])


@router.websocket("/ws/fills")
async def ws_fills_all(websocket: WebSocket):
    await websocket.accept()
    q = subscribe("fills")
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
        unsubscribe("fills", q)


@router.websocket("/ws/fills/{trader}")
async def ws_fills_trader(websocket: WebSocket, trader: str):
    await websocket.accept()
    key = f"fills:{trader}"
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
