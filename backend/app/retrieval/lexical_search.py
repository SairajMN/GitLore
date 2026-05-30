"""Lexical search using PostgreSQL full-text search and ILIKE."""

import logging
from typing import Optional
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Artifact

logger = logging.getLogger(__name__)


async def lexical_search(
    session: AsyncSession,
    repo_id: UUID,
    query_text: str,
    limit: int = 20,
) -> list[Artifact]:
    """Full-text search using tsvector/tsquery."""
    try:
        stmt = text("""
            SELECT * FROM artifacts
            WHERE repository_id = $1
            AND search_vector @@ plainto_tsquery('english', $2)
            ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC
            LIMIT $3
        """)
        result = await session.execute(stmt, (str(repo_id), query_text, limit))
        rows = result.fetchall()
        artifacts = []
        for row in rows:
            # Convert row to Artifact-like object
            artifacts.append(_row_to_artifact(row))
        return artifacts
    except Exception as e:
        logger.warning("Lexical search failed, falling back to ILIKE: %s", e)
        return await _fallback_ilike_search(session, repo_id, query_text, limit)


async def exact_match_search(
    session: AsyncSession,
    repo_id: UUID,
    search_text: str,
    limit: int = 20,
) -> list[Artifact]:
    """Exact substring match on title, description, content."""
    stmt = select(Artifact).where(
        Artifact.repository_id == repo_id,
    ).where(
        Artifact.title.ilike(f"%{search_text}%")
        | Artifact.description.ilike(f"%{search_text}%")
        | Artifact.content.ilike(f"%{search_text}%")
    ).order_by(Artifact.date.desc().nullslast()).limit(limit)

    result = await session.execute(stmt)
    return list(result.scalars().all())


async def _fallback_ilike_search(
    session: AsyncSession,
    repo_id: UUID,
    query_text: str,
    limit: int,
) -> list[Artifact]:
    """Fallback ILIKE search when tsvector is not available."""
    stmt = select(Artifact).where(
        Artifact.repository_id == repo_id,
    ).where(
        Artifact.title.ilike(f"%{query_text}%")
        | Artifact.description.ilike(f"%{query_text}%")
        | Artifact.content.ilike(f"%{query_text}%")
    ).order_by(Artifact.date.desc().nullslast()).limit(limit)

    result = await session.execute(stmt)
    return list(result.scalars().all())


def _row_to_artifact(row) -> Artifact:
    """Convert a database row to an Artifact model."""
    artifact = Artifact()
    for key in ["id", "repository_id", "artifact_type", "external_id", "title", "description",
                "content", "author", "date", "url", "created_at", "updated_at"]:
        if hasattr(row, key):
            setattr(artifact, key, getattr(row, key))
        elif hasattr(row, f"_{key}"):
            setattr(artifact, key, getattr(row, f"_{key}"))
    # Handle metadata column
    if hasattr(row, "metadata"):
        artifact.metadata_ = getattr(row, "metadata", {})
    elif hasattr(row, "metadata_"):
        artifact.metadata_ = getattr(row, "metadata_", {})
    return artifact
