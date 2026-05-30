"""Background indexing worker — ingests repository artifacts asynchronously."""

import logging
from uuid import UUID
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import Repository, IndexingJob
from app.ingestion.ingestion_service import IngestionService

logger = logging.getLogger(__name__)


async def run_indexing_job(
    session: AsyncSession,
    job_id: UUID,
    repo_id: UUID,
    owner: str,
    name: str,
    branch: str = "main",
    token: str | None = None,
):
    """Execute an indexing job in the background."""
    job = await session.get(IndexingJob, job_id)
    if not job:
        logger.error("Indexing job %s not found", job_id)
        return

    try:
        job.status = "running"
        job.started_at = datetime.utcnow()
        await session.commit()

        service = IngestionService(session)
        counts = await service.ingest_repo(repo_id, owner, name, branch, token)

        job.status = "completed"
        job.artifacts_processed = sum(counts.values())
        job.completed_at = datetime.utcnow()
        await session.commit()

        logger.info("Indexing job %s completed: %s", job_id, counts)

    except Exception as e:
        logger.error("Indexing job %s failed: %s", job_id, e)
        await session.rollback()
        try:
            job = await session.get(IndexingJob, job_id)
            if job:
                job.status = "failed"
                job.errors += 1
                job.completed_at = datetime.utcnow()
                await session.commit()
        except Exception as save_error:
            logger.error("Could not save failed status for job %s: %s", job_id, save_error)
