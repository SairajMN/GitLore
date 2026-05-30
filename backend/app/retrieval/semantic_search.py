"""Semantic search using pgvector embeddings."""

import logging
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Artifact

logger = logging.getLogger(__name__)


async def semantic_search(
    session: AsyncSession,
    repo_id: UUID,
    query_embedding: list[float],
    limit: int = 20,
    similarity_threshold: float = 0.3,
) -> list[tuple[Artifact, float]]:
    """Search for artifacts by embedding similarity using pgvector cosine distance."""
    if not query_embedding:
        return []

    try:
        # Use cosine distance operator (<=>)
        embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
        stmt = text("""
            SELECT *, 1 - (embedding <=> :embedding::vector) as similarity
            FROM artifacts
            WHERE repository_id = :repo_id
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> :embedding::vector) > :threshold
            ORDER BY embedding <=> :embedding::vector
            LIMIT :limit
        """)
        result = await session.execute(stmt, {
            "embedding": embedding_str,
            "repo_id": str(repo_id),
            "threshold": similarity_threshold,
            "limit": limit,
        })
        rows = result.fetchall()
        artifacts_with_scores = []
        for row in rows:
            artifact = _row_to_artifact(row)
            similarity = getattr(row, "similarity", 0.0)
            artifacts_with_scores.append((artifact, float(similarity)))
        return artifacts_with_scores
    except Exception as e:
        logger.warning("Semantic search failed: %s", e)
        return []


async def store_embedding(session: AsyncSession, artifact_id: UUID, embedding: list[float]):
    """Store an embedding for an artifact."""
    try:
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        stmt = text("""
            UPDATE artifacts SET embedding = :embedding::vector WHERE id = :id
        """)
        await session.execute(stmt, {"embedding": embedding_str, "id": str(artifact_id)})
    except Exception as e:
        logger.warning("Failed to store embedding for %s: %s", artifact_id, e)


async def compute_query_embedding(query_text: str) -> list[float]:
    """Compute embedding for a query string. Uses a simple TF-IDF-like approach for MVP.
    
    In production, this would call an embedding model via the provider router.
    For now, returns a hash-based pseudo-embedding for demonstration.
    """
    import hashlib
    import struct

    # Simple deterministic embedding based on text content
    # This is a placeholder - real implementation would use an embedding model
    text_bytes = query_text.encode("utf-8")
    embedding = []
    for i in range(1536):
        h = hashlib.sha256(text_bytes + struct.pack(">I", i)).digest()
        # Convert first 4 bytes to float in [-1, 1]
        val = struct.unpack(">i", h[:4])[0] / (2**31)
        embedding.append(val)

    # Normalize
    norm = sum(x * x for x in embedding) ** 0.5
    if norm > 0:
        embedding = [x / norm for x in embedding]

    return embedding


def _row_to_artifact(row) -> Artifact:
    artifact = Artifact()
    for key in ["id", "repository_id", "artifact_type", "external_id", "title", "description",
                "content", "author", "date", "url", "created_at", "updated_at"]:
        if hasattr(row, key):
            setattr(artifact, key, getattr(row, key))
        elif hasattr(row, f"_{key}"):
            setattr(artifact, key, getattr(row, f"_{key}"))
    if hasattr(row, "metadata"):
        artifact.metadata_ = getattr(row, "metadata", {})
    elif hasattr(row, "metadata_"):
        artifact.metadata_ = getattr(row, "metadata_", {})
    return artifact
