"""Retrieval orchestrator — combines lexical, semantic, and graph search into unified retrieval."""

import re
import logging
from uuid import UUID
from typing import Optional
from dataclasses import dataclass, field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Artifact
from app.retrieval.lexical_search import lexical_search, exact_match_search
from app.retrieval.semantic_search import semantic_search, compute_query_embedding
from app.retrieval.graph_expansion import expand_graph

logger = logging.getLogger(__name__)


@dataclass
class RetrievalResult:
    artifacts: list[Artifact] = field(default_factory=list)
    scores: dict[str, float] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)  # artifact_id -> source type


def extract_entities(text: str) -> dict:
    """Extract structured entities from query text."""
    entities = []

    # Issue/PR numbers (#123, #456)
    for match in re.finditer(r"#(\d+)", text):
        entities.append({"type": "issue_or_pr", "value": match.group(1)})

    # Commit hashes (7-40 hex chars)
    for match in re.finditer(r"\b([0-9a-f]{7,40})\b", text):
        entities.append({"type": "commit_hash", "value": match.group(1)})

    # Quoted strings (likely symbol names)
    for match in re.finditer(r'"([^"]+)"', text):
        entities.append({"type": "symbol", "value": match.group(1)})

    # File paths
    for match in re.finditer(r"[\w/]+\.\w{1,5}", text):
        entities.append({"type": "file_path", "value": match.group(0)})

    # CamelCase/PascalCase identifiers
    for match in re.finditer(r"\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]*)+)\b", text):
        entities.append({"type": "identifier", "value": match.group(1)})

    return {
        "entities": entities,
        "search_terms": _extract_search_terms(text),
    }


def _extract_search_terms(text: str) -> list[str]:
    """Extract meaningful search terms from query."""
    # Remove common stop words
    stop_words = {
        "why", "does", "this", "the", "is", "was", "has", "have", "had",
        "do", "did", "it", "that", "there", "what", "when", "where", "how",
        "which", "who", "whom", "whose", "still", "support", "code", "function",
        "method", "class", "file", "module", "a", "an", "in", "on", "at", "to",
        "for", "of", "with", "by", "from", "as", "or", "and", "not", "no",
        "be", "are", "were", "been", "being", "can", "could", "would", "should",
        "may", "might", "shall", "will", "must",
    }
    words = re.findall(r"\b[a-zA-Z]\w+\b", text.lower())
    return [w for w in words if w not in stop_words and len(w) > 2]


async def retrieve(
    session: AsyncSession,
    repo_id: UUID,
    query_text: str,
    limit: int = 20,
) -> RetrievalResult:
    """Hybrid retrieval combining lexical, semantic, and graph search."""
    result = RetrievalResult()
    all_artifacts: dict[str, tuple[Artifact, float, str]] = {}

    entities_info = extract_entities(query_text)
    search_terms = entities_info["search_terms"]
    effective_query = " ".join(search_terms) if search_terms else query_text

    # 1. Exact match for entities
    for entity in entities_info["entities"]:
        if entity["type"] in ("issue_or_pr", "commit_hash", "file_path", "symbol", "identifier"):
            matches = await exact_match_search(session, repo_id, entity["value"], limit=5)
            for artifact in matches:
                aid = str(artifact.id)
                if aid not in all_artifacts:
                    all_artifacts[aid] = (artifact, 0.9, "exact_match")

    # 2. Lexical search
    try:
        lexical_results = await lexical_search(session, repo_id, effective_query, limit=limit)
        for artifact in lexical_results:
            aid = str(artifact.id)
            if aid not in all_artifacts:
                all_artifacts[aid] = (artifact, 0.6, "lexical")
            else:
                # Boost score for appearing in multiple sources
                existing = all_artifacts[aid]
                all_artifacts[aid] = (existing[0], min(existing[1] + 0.1, 1.0), existing[2])
    except Exception as e:
        logger.warning("Lexical search failed: %s", e)

    # 3. Semantic search
    try:
        query_embedding = await compute_query_embedding(query_text)
        semantic_results = await semantic_search(session, repo_id, query_embedding, limit=limit)
        for artifact, similarity in semantic_results:
            aid = str(artifact.id)
            if aid not in all_artifacts:
                all_artifacts[aid] = (artifact, similarity * 0.7, "semantic")
            else:
                existing = all_artifacts[aid]
                all_artifacts[aid] = (existing[0], max(existing[1], similarity * 0.7), existing[2])
    except Exception as e:
        logger.warning("Semantic search failed: %s", e)

    # 4. Graph expansion from top results
    seed_ids = []
    sorted_by_score = sorted(all_artifacts.items(), key=lambda x: x[1][1], reverse=True)
    for aid_str, (artifact, score, _) in sorted_by_score[:5]:
        seed_ids.append(UUID(aid_str))

    if seed_ids:
        try:
            expanded = await expand_graph(session, seed_ids, max_hops=1, limit_per_hop=5)
            for artifact in expanded:
                aid = str(artifact.id)
                if aid not in all_artifacts:
                    all_artifacts[aid] = (artifact, 0.3, "graph")
        except Exception as e:
            logger.warning("Graph expansion failed: %s", e)

    # 5. If no results, get most recent artifacts as fallback
    if not all_artifacts:
        from sqlalchemy import select
        from app.db.models import Artifact as ArtifactModel
        stmt = select(ArtifactModel).where(
            ArtifactModel.repository_id == repo_id
        ).order_by(ArtifactModel.date.desc().nullslast()).limit(10)
        db_result = await session.execute(stmt)
        for artifact in db_result.scalars().all():
            aid = str(artifact.id)
            all_artifacts[aid] = (artifact, 0.1, "recent_fallback")

    # Sort by score and build result
    sorted_results = sorted(all_artifacts.items(), key=lambda x: x[1][1], reverse=True)
    for aid_str, (artifact, score, source) in sorted_results[:limit]:
        result.artifacts.append(artifact)
        result.scores[aid_str] = score
        result.sources[aid_str] = source

    logger.info(
        "Retrieval complete: query='%s' results=%d sources=%s",
        query_text[:50], len(result.artifacts), list(set(result.sources.values()))
    )
    return result
