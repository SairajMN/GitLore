"""GET /api/answer/{id} — Retrieve a saved answer with evidence."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db.models import Answer, Evidence, Query as QueryModel

router = APIRouter()


@router.get("/answer/{answer_id}")
async def get_answer(answer_id: str, db: AsyncSession = Depends(get_db)):
    try:
        aid = uuid.UUID(answer_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid answer ID")
    
    answer = await db.get(Answer, aid)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    
    # Get evidence
    stmt = select(Evidence).where(Evidence.answer_id == aid).order_by(Evidence.relevance_score.desc())
    result = await db.execute(stmt)
    evidence = result.scalars().all()
    
    # Get query text
    query = await db.get(QueryModel, answer.query_id)
    
    evidence_list = [
        {
            "id": str(e.id), "artifact_id": str(e.artifact_id),
            "relevance_score": e.relevance_score, "excerpt": e.excerpt,
            "claim": e.claim, "citation_url": e.citation_url, "is_direct": e.is_direct,
            "artifact_type": e.metadata_.get("artifact_type") if e.metadata_ else None,
            "artifact_title": e.metadata_.get("artifact_title") if e.metadata_ else None,
        }
        for e in evidence
    ]
    
    return {
        "answer": {
            "id": str(answer.id), "query_id": str(answer.query_id),
            "answer_text": answer.answer_text, "confidence": answer.confidence,
            "uncertainty_notes": answer.uncertainty_notes,
            "synthesis_latency_ms": answer.synthesis_latency_ms,
            "model_used": answer.model_used,
            "evidence_ids": answer.evidence_ids or [],
            "hypotheses": answer.hypotheses or [],
            "created_at": answer.created_at.isoformat() if answer.created_at else None,
        },
        "evidence": evidence_list,
        "query_text": query.text if query else None,
        "repository_id": str(query.repository_id) if query else None,
    }
