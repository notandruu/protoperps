import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .kafka import start_consumers
from .routes import orders, orderbook
from .ws import fills, orderbook as ws_orderbook

app = FastAPI(title="Trading Engine API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orders.router)
app.include_router(orderbook.router)
app.include_router(ws_orderbook.router)
app.include_router(fills.router)


@app.on_event("startup")
async def startup():
    asyncio.create_task(start_consumers())


@app.get("/health")
async def health():
    return {"status": "ok"}
