"""GET /api/index-status — Check indexing progress."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db.models import Repository, Artifact, IndexingJob
from app.schemas.schemas import IndexStatusResponse

router = APIRouter()


@router.get("/index-status")
async def get_index_status(repo_id: str, db: AsyncSession = Depends(get_db)):
    try:
        rid = uuid.UUID(repo_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid repo_id")
    
    repo = await db.get(Repository, rid)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    
    # Get artifact counts
    stmt = select(Artifact.artifact_type).where(Artifact.repository_id == rid)
    result = await db.execute(stmt)
    types = result.scalars().all()
    counts = {}
    for t in types:
        counts[t] = counts.get(t, 0) + 1
    
    # Get latest job status
    job_stmt = select(IndexingJob).where(IndexingJob.repository_id == rid).order_by(IndexingJob.created_at.desc()).limit(1)
    job_result = await db.execute(job_stmt)
    job = job_result.scalar_one_or_none()
    
    return IndexStatusResponse(
        repository_id=str(rid),
        is_indexed=repo.is_indexed,
        last_indexed_at=repo.last_indexed_at,
        index_version=repo.index_version,
        artifact_counts=counts,
        job_status=job.status if job else None,
    )
