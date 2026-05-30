"""Pipeline orchestrator — wires together interpret, retrieve, evidence, synthesize."""

import uuid
import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.models import (
    Repository, Artifact, Query as QueryModel, Answer, Evidence, IndexingJob
)
from app.services.query_interpreter import QueryInterpreter
from app.retrieval.retrieval_orchestrator import retrieve
from app.services.evidence_builder import EvidencePackBuilder
from app.services.answer_synthesizer import AnswerSynthesizer

logger = logging.getLogger(__name__)


class PipelineOrchestrator:
    """Main pipeline: query -> interpret -> retrieve -> build evidence -> synthesize -> return."""

    def __init__(self):
        self.interpreter = QueryInterpreter()
        self.evidence_builder = EvidencePackBuilder()
        self.synthesizer = AnswerSynthesizer()

    async def run_query(self, session: AsyncSession, repo_id: uuid.UUID, query_text: str) -> dict:
        """Execute the full query pipeline."""
        # 1. Interpret the query
        interpretation = await self.interpreter.interpret(query_text)

        # 2. Save the query
        query_record = QueryModel(
            repository_id=repo_id,
            text=query_text,
            intent=interpretation.intent,
            entities=interpretation.entities,
            time_hints=interpretation.time_hints,
        )
        session.add(query_record)
        await session.flush()

        # 3. Retrieve evidence
        retrieval_result = await retrieve(session, repo_id, query_text, limit=20)

        # 4. Build evidence pack
        evidence_pack = self.evidence_builder.build(
            retrieval_result.artifacts,
            retrieval_result.scores,
            retrieval_result.sources,
            query_text,
        )

        # 5. Synthesize answer
        synthesis = await self.synthesizer.synthesize(query_text, evidence_pack)

        # 6. Save answer
        answer = Answer(
            query_id=query_record.id,
            answer_text=synthesis.answer_text,
            confidence=synthesis.confidence,
            uncertainty_notes=synthesis.uncertainty_notes,
            synthesis_latency_ms=synthesis.latency_ms,
            model_used=synthesis.model_used,
            evidence_ids=[e.artifact_id for e in evidence_pack.entries],
            hypotheses=synthesis.hypotheses,
        )
        session.add(answer)
        await session.flush()

        # 7. Save evidence entries
        evidence_records = []
        for entry in evidence_pack.entries:
            ev = Evidence(
                answer_id=answer.id,
                artifact_id=uuid.UUID(entry.artifact_id),
                relevance_score=entry.relevance_score,
                excerpt=entry.excerpt,
                claim=entry.claim,
                citation_url=entry.artifact_url,
                is_direct=entry.is_direct,
                metadata_={"artifact_type": entry.artifact_type, "artifact_title": entry.artifact_title},
            )
            session.add(ev)
            evidence_records.append(ev)

        await session.flush()

        # 8. Build timeline
        timeline = self._build_timeline(retrieval_result.artifacts)

        # 9. Build response
        return {
            "query_id": query_record.id,
            "answer": {
                "id": answer.id,
                "query_id": answer.query_id,
                "answer_text": answer.answer_text,
                "confidence": answer.confidence,
                "uncertainty_notes": answer.uncertainty_notes,
                "synthesis_latency_ms": answer.synthesis_latency_ms,
                "model_used": answer.model_used,
                "evidence_ids": answer.evidence_ids or [],
                "hypotheses": answer.hypotheses or [],
                "created_at": answer.created_at.isoformat() if answer.created_at else datetime.utcnow().isoformat(),
            },
            "evidence": [
                {
                    "id": ev.id,
                    "artifact_id": ev.artifact_id,
                    "relevance_score": ev.relevance_score,
                    "excerpt": ev.excerpt,
                    "claim": ev.claim,
                    "citation_url": ev.citation_url,
                    "is_direct": ev.is_direct,
                    "artifact_type": ev.metadata_.get("artifact_type") if ev.metadata_ else None,
                    "artifact_title": ev.metadata_.get("artifact_title") if ev.metadata_ else None,
                    "artifact_url": ev.citation_url,
                    "artifact_date": None,
                }
                for ev in evidence_records
            ],
            "timeline": timeline,
        }

    def _build_timeline(self, artifacts: list) -> list[dict]:
        events = []
        for a in sorted(artifacts, key=lambda x: x.date or datetime.min, reverse=True)[:50]:
            events.append({
                "date": a.date.isoformat() if a.date else None,
                "artifact_type": a.artifact_type,
                "title": a.title or "Untitled",
                "description": (a.description or "")[:200],
                "url": a.url,
                "author": a.author,
            })
        return events
