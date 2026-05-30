"""Graph expansion — traverses relation links to find connected artifacts."""

import logging
from uuid import UUID
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Artifact, Relation

logger = logging.getLogger(__name__)


async def expand_graph(
    session: AsyncSession,
    artifact_ids: list[UUID],
    max_hops: int = 2,
    limit_per_hop: int = 10,
) -> list[Artifact]:
    """Expand from seed artifacts through relation graph to find connected artifacts."""
    visited = set(str(aid) for aid in artifact_ids)
    current_ids = list(artifact_ids)
    all_expanded = []

    for hop in range(max_hops):
        if not current_ids:
            break

        # Find all artifacts related to current set
        stmt = select(Artifact).join(
            Relation,
            or_(
                Relation.source_id == Artifact.id,
                Relation.target_id == Artifact.id,
            ),
        ).where(
            or_(
                Relation.source_id.in_(current_ids),
                Relation.target_id.in_(current_ids),
            ),
            Artifact.id.notin_([UUID(v) for v in visited] if visited else []),
        ).limit(limit_per_hop * len(current_ids))

        result = await session.execute(stmt)
        new_artifacts = list(result.scalars().all())

        next_ids = []
        for artifact in new_artifacts:
            aid_str = str(artifact.id)
            if aid_str not in visited:
                visited.add(aid_str)
                all_expanded.append(artifact)
                next_ids.append(artifact.id)

        current_ids = next_ids
        logger.debug("Graph expansion hop %d: found %d new artifacts", hop + 1, len(next_ids))

    return all_expanded


async def get_artifact_relations(
    session: AsyncSession,
    artifact_id: UUID,
) -> list[dict]:
    """Get all relations for an artifact with their connected artifacts."""
    stmt = select(Relation).where(
        or_(
            Relation.source_id == artifact_id,
            Relation.target_id == artifact_id,
        )
    )
    result = await session.execute(stmt)
    relations = result.scalars().all()

    enriched = []
    for rel in relations:
        other_id = rel.target_id if rel.source_id == artifact_id else rel.source_id
        other = await session.get(Artifact, other_id)
        enriched.append({
            "relation_type": rel.relation_type,
            "direction": "outgoing" if rel.source_id == artifact_id else "incoming",
            "artifact": other,
        })

    return enriched
