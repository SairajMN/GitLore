"""POST /api/query — Ask a question about a repository."""

import uuid as _uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import Repository
from app.schemas.schemas import QueryRequest, QueryResponse
from app.services.orchestrator import PipelineOrchestrator

router = APIRouter()


@router.post("/query")
async def query_repo(req: QueryRequest, db: AsyncSession = Depends(get_db)):
    # Validate repo exists
    try:
        repo_uuid = _uuid.UUID(req.repository_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid repository_id format")
    
    repo = await db.get(Repository, repo_uuid)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository is still being indexed")
    
    orchestrator = PipelineOrchestrator()
    result = await orchestrator.run_query(db, repo_uuid, req.text)
    
    return result
