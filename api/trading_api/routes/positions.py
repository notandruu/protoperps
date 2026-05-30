from fastapi import APIRouter, HTTPException
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from ..config import settings

router = APIRouter(tags=["positions"])

_engine = None
_AsyncSession = None


def _get_session():
    global _engine, _AsyncSession
    if _engine is None:
        _engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        _AsyncSession = sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    return _AsyncSession


@router.get("/positions/{trader}")
async def get_positions(trader: str):
    Session = _get_session()
    async with Session() as session:
        result = await session.execute(
            text(
                "SELECT market, side, size, entry_price, collateral, realized_pnl "
                "FROM positions WHERE trader = :t AND size > 0 "
                "ORDER BY market"
            ),
            {"t": trader},
        )
        rows = result.mappings().all()
        return [dict(r) for r in rows]


@router.get("/positions/{trader}/{market}")
async def get_position(trader: str, market: str):
    Session = _get_session()
    async with Session() as session:
        result = await session.execute(
            text(
                "SELECT market, side, size, entry_price, collateral, realized_pnl "
                "FROM positions WHERE trader = :t AND market = :m"
            ),
            {"t": trader, "m": market.upper()},
        )
        row = result.mappings().first()
        if row is None:
            return None
        return dict(row)


@router.get("/fills/{trader}")
async def get_fills(trader: str, limit: int = 100):
    Session = _get_session()
    async with Session() as session:
        result = await session.execute(
            text(
                "SELECT market, taker_side, price, size, realized_pnl, created_at "
                "FROM fills WHERE taker = :t OR maker = :t "
                "ORDER BY created_at DESC LIMIT :lim"
            ),
            {"t": trader, "lim": min(limit, 500)},
        )
        rows = result.mappings().all()
        return [dict(r) for r in rows]
