"""POST /api/connect — Register a GitHub repository and start indexing."""

import uuid
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db.models import Repository, IndexingJob
from app.schemas.schemas import ConnectRepoRequest, ConnectRepoResponse, RepositoryOut
from app.workers.indexing_worker import run_indexing_job
from app.config import get_settings

router = APIRouter()


@router.post("/connect", response_model=ConnectRepoResponse)
async def connect_repo(
    req: ConnectRepoRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    full_name = f"{req.owner}/{req.name}"
    
    # Upsert repository
    stmt = select(Repository).where(Repository.full_name == full_name)
    result = await db.execute(stmt)
    repo = result.scalar_one_or_none()
    
    if repo:
        repo.updated_at = __import__("datetime").datetime.utcnow()
    else:
        repo = Repository(
            owner=req.owner, name=req.name, full_name=full_name,
            git_url=f"https://github.com/{full_name}",
        )
        db.add(repo)
    
    await db.flush()
    
    # Create indexing job
    job = IndexingJob(repository_id=repo.id, status="pending")
    db.add(job)
    await db.flush()
    
    settings = get_settings()
    token = req.token or settings.github_token
    
    # Start background indexing
    background_tasks.add_task(
        run_indexing_job,
        db, job.id, repo.id, req.owner, req.name,
        repo.default_branch, token,
    )
    
    return ConnectRepoResponse(
        repository=RepositoryOut.model_validate(repo),
        indexing_job_id=str(job.id),
    )
