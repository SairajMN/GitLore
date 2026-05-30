"""CRUD for saved investigations."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.db.models import Investigation, Answer, Evidence
from app.schemas.schemas import (
    CreateInvestigationRequest, InvestigationOut, InvestigationDetailResponse,
    AnswerOut, EvidenceEntryOut,
)

router = APIRouter()


@router.post("/investigation")
async def create_investigation(req: CreateInvestigationRequest, db: AsyncSession = Depends(get_db)):
    inv = Investigation(
        repository_id=uuid.UUID(req.repository_id),
        title=req.title, query_text=req.query_text,
        answer_id=uuid.UUID(req.answer_id) if req.answer_id else None,
        is_public=req.is_public,
    )
    db.add(inv)
    await db.flush()
    return InvestigationOut.model_validate(inv)


@router.get("/investigation/{investigation_id}")
async def get_investigation(investigation_id: str, db: AsyncSession = Depends(get_db)):
    try:
        inv_uuid = uuid.UUID(investigation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID")
    
    inv = await db.get(Investigation, inv_uuid)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    
    answer = None
    evidence = []
    
    if inv.answer_id:
        ans = await db.get(Answer, inv.answer_id)
        if ans:
            answer = AnswerOut.model_validate(ans)
            stmt = select(Evidence).where(Evidence.answer_id == inv.answer_id)
            result = await db.execute(stmt)
            evidence = [EvidenceEntryOut.model_validate(e) for e in result.scalars().all()]
    
    return InvestigationDetailResponse(
        investigation=InvestigationOut.model_validate(inv),
        answer=answer, evidence=evidence,
    )


@router.get("/investigation")
async def list_investigations(repo_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Investigation).where(
        Investigation.repository_id == uuid.UUID(repo_id)
    ).order_by(Investigation.created_at.desc())
    result = await db.execute(stmt)
    return [InvestigationOut.model_validate(i) for i in result.scalars().all()]
