"""POST /api/feedback — Capture answer quality feedback."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import Answer, Feedback
from app.schemas.schemas import FeedbackRequest, FeedbackResponse

router = APIRouter()


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(req: FeedbackRequest, db: AsyncSession = Depends(get_db)):
    try:
        answer_uuid = uuid.UUID(req.answer_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid answer_id")
    
    answer = await db.get(Answer, answer_uuid)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    
    feedback = Feedback(
        answer_id=answer_uuid,
        feedback_type=req.feedback_type,
        comment=req.comment,
    )
    db.add(feedback)
    await db.flush()
    
    return FeedbackResponse.model_validate(feedback)
