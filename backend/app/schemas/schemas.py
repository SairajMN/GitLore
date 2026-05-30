"""Pydantic v2 schemas for API request/response models."""

from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


# ─── Repository ──────────────────────────────────────────────────

class ConnectRepoRequest(BaseModel):
    owner: str
    name: str
    token: Optional[str] = None


class RepositoryOut(BaseModel):
    id: uuid.UUID
    owner: str
    name: str
    full_name: str
    git_url: Optional[str] = None
    default_branch: str = "main"
    is_private: bool = False
    is_indexed: bool = False
    last_indexed_at: Optional[datetime] = None
    index_version: int = 0
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ConnectRepoResponse(BaseModel):
    repository: RepositoryOut
    indexing_job_id: str


# ─── Query ───────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    repository_id: str
    text: str


class QueryInterpretationOut(BaseModel):
    intent: str
    entities: List[dict[str, str]]
    time_hints: dict[str, Any]
    search_terms: List[str]
    confidence: float


# ─── Evidence ────────────────────────────────────────────────────

class EvidenceEntryOut(BaseModel):
    id: uuid.UUID
    artifact_id: uuid.UUID
    relevance_score: float
    excerpt: Optional[str] = None
    claim: Optional[str] = None
    citation_url: Optional[str] = None
    is_direct: bool = False
    artifact_type: Optional[str] = None
    artifact_title: Optional[str] = None
    artifact_url: Optional[str] = None
    artifact_date: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ─── Timeline ────────────────────────────────────────────────────

class TimelineEvent(BaseModel):
    date: Optional[datetime] = None
    artifact_type: str
    title: str
    description: Optional[str] = None
    url: Optional[str] = None
    author: Optional[str] = None


# ─── Hypothesis ─────────────────────────────────────────────────

class Hypothesis(BaseModel):
    rank: int
    explanation: str
    confidence: float
    evidence_ids: List[str] = []


# ─── Answer ──────────────────────────────────────────────────────

class AnswerOut(BaseModel):
    id: uuid.UUID
    query_id: uuid.UUID
    answer_text: str
    confidence: float
    uncertainty_notes: Optional[str] = None
    synthesis_latency_ms: Optional[int] = None
    model_used: Optional[str] = None
    evidence_ids: List[str] = []
    hypotheses: List[Hypothesis] = []
    created_at: datetime
    model_config = {"from_attributes": True}


class QueryResponse(BaseModel):
    query_id: uuid.UUID
    answer: AnswerOut
    evidence: List[EvidenceEntryOut]
    timeline: List[TimelineEvent]


# ─── Answer Detail ───────────────────────────────────────────────

class AnswerDetailResponse(BaseModel):
    answer: AnswerOut
    evidence: List[EvidenceEntryOut]
    query_text: Optional[str] = None
    repository_id: Optional[uuid.UUID] = None


# ─── Feedback ────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    answer_id: str
    feedback_type: str
    comment: Optional[str] = None


class FeedbackResponse(BaseModel):
    id: uuid.UUID
    answer_id: uuid.UUID
    feedback_type: str
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Investigation ───────────────────────────────────────────────

class CreateInvestigationRequest(BaseModel):
    repository_id: str
    title: Optional[str] = None
    query_text: str
    answer_id: Optional[str] = None
    is_public: bool = False


class InvestigationOut(BaseModel):
    id: uuid.UUID
    repository_id: uuid.UUID
    title: Optional[str] = None
    query_text: str
    answer_id: Optional[uuid.UUID] = None
    is_public: bool = False
    share_token: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class InvestigationDetailResponse(BaseModel):
    investigation: InvestigationOut
    answer: Optional[AnswerOut] = None
    evidence: List[EvidenceEntryOut] = []


# ─── Watchlist ──────────────────────────────────────────────────

class CreateWatchlistRequest(BaseModel):
    repository_id: str
    name: str
    query_filters: dict[str, Any] = {}
    notify_on_update: bool = False


class WatchlistOut(BaseModel):
    id: uuid.UUID
    repository_id: uuid.UUID
    name: str
    query_filters: dict[str, Any] = {}
    notify_on_update: bool = False
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ─── Index Status ────────────────────────────────────────────────

class IndexStatusResponse(BaseModel):
    repository_id: str
    is_indexed: bool
    last_indexed_at: Optional[datetime] = None
    index_version: int
    artifact_counts: dict[str, int]
    job_status: Optional[str] = None