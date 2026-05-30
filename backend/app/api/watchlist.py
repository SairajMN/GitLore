"""CRUD for watchlists."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db.models import Watchlist
from app.schemas.schemas import CreateWatchlistRequest, WatchlistOut

router = APIRouter()


@router.post("/watchlist", response_model=WatchlistOut)
async def create_watchlist(req: CreateWatchlistRequest, db: AsyncSession = Depends(get_db)):
    wl = Watchlist(
        repository_id=uuid.UUID(req.repository_id),
        name=req.name, query_filters=req.query_filters,
        notify_on_update=req.notify_on_update,
    )
    db.add(wl)
    await db.flush()
    return WatchlistOut.model_validate(wl)


@router.get("/watchlist")
async def list_watchlists(repo_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Watchlist).where(
        Watchlist.repository_id == uuid.UUID(repo_id)
    ).order_by(Watchlist.created_at.desc())
    result = await db.execute(stmt)
    return [WatchlistOut.model_validate(w) for w in result.scalars().all()]
