from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..kafka import publish_order

router = APIRouter(prefix="/orders", tags=["orders"])


class PlaceOrderRequest(BaseModel):
    trader: str
    market: str
    side: str = Field(pattern="^(long|short)$")
    order_type: str = Field(default="limit", pattern="^(limit|market|post_only)$")
    price: int = Field(default=0, ge=0)
    size: int = Field(gt=0)


class CancelOrderRequest(BaseModel):
    trader: str
    market: str
    sequence_number: int


@router.post("/")
async def place_order(req: PlaceOrderRequest):
    payload = {
        "type": "place",
        "trader": req.trader,
        "market": req.market,
        "side": req.side,
        "order_type": req.order_type,
        "price": req.price,
        "size": req.size,
    }
    try:
        await publish_order(payload)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"order submission failed: {e}")
    return {"status": "accepted"}


@router.delete("/{sequence_number}")
async def cancel_order(sequence_number: int, trader: str, market: str):
    payload = {
        "type": "cancel",
        "trader": trader,
        "market": market,
        "sequence_number": sequence_number,
    }
    try:
        await publish_order(payload)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"status": "accepted"}
