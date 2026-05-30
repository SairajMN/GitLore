"""SQLAlchemy 2 ORM models for GitLore."""

import uuid
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    String, Text, Boolean, Integer, Float, DateTime,
    ForeignKey, JSON, UniqueConstraint, Index, FetchedValue
)
from sqlalchemy.dialects.postgresql import UUID, TSVECTOR, ENUM, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.db.database import Base


def generate_uuid():
    return uuid.uuid4()


class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    git_url: Mapped[Optional[str]] = mapped_column(Text)
    default_branch: Mapped[str] = mapped_column(String(255), default="main")
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    is_indexed: Mapped[bool] = mapped_column(Boolean, default=False)
    last_indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    index_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    artifacts: Mapped[List["Artifact"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    code_symbols: Mapped[List["CodeSymbol"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    queries: Mapped[List["Query"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    investigations: Mapped[List["Investigation"]] = relationship(back_populates="repository", cascade="all, delete-orphan")
    watchlists: Mapped[List["Watchlist"]] = relationship(back_populates="repository", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("owner", "name"),)


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    artifact_type: Mapped[str] = mapped_column(
        ENUM("commit", "pr", "issue", "doc", "adr", "release_note", "snapshot", name="artifact_type", create_type=False),
        nullable=False
    )
    external_id: Mapped[Optional[str]] = mapped_column(String(512))
    title: Mapped[Optional[str]] = mapped_column(Text)
    description: Mapped[Optional[str]] = mapped_column(Text)
    content: Mapped[Optional[str]] = mapped_column(Text)
    author: Mapped[Optional[str]] = mapped_column(String(255))
    date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    url: Mapped[Optional[str]] = mapped_column(Text)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON, default=dict)
    embedding: Mapped[Optional[list]] = mapped_column(Vector(1536))
    search_vector: Mapped[Optional[str]] = mapped_column(TSVECTOR, server_default=FetchedValue())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    repository: Mapped["Repository"] = relationship(back_populates="artifacts")
    code_symbols: Mapped[List["CodeSymbol"]] = relationship(back_populates="artifact", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_artifacts_search", "search_vector", postgresql_using="gin"),
        Index("ix_artifacts_repo_type", "repository_id", "artifact_type"),
        Index("ix_artifacts_external", "repository_id", "external_id"),
    )


class CodeSymbol(Base):
    __tablename__ = "code_symbols"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    artifact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("artifacts.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    kind: Mapped[str] = mapped_column(
        ENUM("function", "class", "method", "variable", "interface", "type",
             "enum", "module", "component", "route", "config", "test", "unknown", name="symbol_kind", create_type=False),
        default="unknown"
    )
    file_path: Mapped[Optional[str]] = mapped_column(Text)
    line_start: Mapped[Optional[int]] = mapped_column(Integer)
    line_end: Mapped[Optional[int]] = mapped_column(Integer)
    signature: Mapped[Optional[str]] = mapped_column(Text)
    doc_comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    repository: Mapped["Repository"] = relationship(back_populates="code_symbols")
    artifact: Mapped[Optional["Artifact"]] = relationship(back_populates="code_symbols")

    __table_args__ = (
        Index("ix_symbols_repo_name", "repository_id", "name"),
        Index("ix_symbols_file", "repository_id", "file_path"),
    )


class Relation(Base):
    __tablename__ = "relations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    relation_type: Mapped[str] = mapped_column(
        ENUM("references", "introduces", "fixes", "blocks", "renames",
             "supersedes", "discusses", "explains", "implements", "depends_on",
             "breaks", "reverts", "mentions", name="relation_type", create_type=False),
        nullable=False
    )
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index("ix_relations_source", "source_id"),
        Index("ix_relations_target", "target_id"),
        Index("ix_relations_type", "relation_type"),
    )


class Query(Base):
    __tablename__ = "queries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[Optional[str]] = mapped_column(String(50))
    entities: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    time_hints: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    repository: Mapped["Repository"] = relationship(back_populates="queries")
    answers: Mapped[List["Answer"]] = relationship(back_populates="query", cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    query_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queries.id", ondelete="CASCADE"), nullable=False
    )
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    uncertainty_notes: Mapped[Optional[str]] = mapped_column(Text)
    synthesis_latency_ms: Mapped[Optional[int]] = mapped_column(Integer)
    model_used: Mapped[Optional[str]] = mapped_column(String(255))
    evidence_ids: Mapped[Optional[List[uuid.UUID]]] = mapped_column(ARRAY(UUID), default=list)
    hypotheses: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    query: Mapped["Query"] = relationship(back_populates="answers")
    evidence_entries: Mapped[List["Evidence"]] = relationship(back_populates="answer", cascade="all, delete-orphan")
    feedback_entries: Mapped[List["Feedback"]] = relationship(back_populates="answer", cascade="all, delete-orphan")


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    answer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("answers.id", ondelete="CASCADE"), nullable=False
    )
    artifact_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    relevance_score: Mapped[float] = mapped_column(Float, default=0.0)
    excerpt: Mapped[Optional[str]] = mapped_column(Text)
    claim: Mapped[Optional[str]] = mapped_column(Text)
    citation_url: Mapped[Optional[str]] = mapped_column(Text)
    is_direct: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    answer: Mapped["Answer"] = relationship(back_populates="evidence_entries")


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    answer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("answers.id", ondelete="CASCADE"), nullable=False
    )
    feedback_type: Mapped[str] = mapped_column(
        ENUM("helpful", "unhelpful", "inaccurate", "missing_evidence", "other", name="feedback_type", create_type=False),
        nullable=False
    )
    comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    answer: Mapped["Answer"] = relationship(back_populates="feedback_entries")


class Investigation(Base):
    __tablename__ = "investigations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[Optional[str]] = mapped_column(Text)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    share_token: Mapped[str] = mapped_column(String(255), unique=True, default=lambda: str(uuid.uuid4()))
    created_by: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    repository: Mapped["Repository"] = relationship(back_populates="investigations")


class Watchlist(Base):
    __tablename__ = "watchlists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    query_filters: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    notify_on_update: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    repository: Mapped["Repository"] = relationship(back_populates="watchlists")


class IndexingJob(Base):
    __tablename__ = "indexing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        ENUM("pending", "running", "completed", "failed", name="job_status", create_type=False),
        default="pending"
    )
    artifacts_processed: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    repository_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    details: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    performed_by: Mapped[Optional[str]] = mapped_column(String(255))
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)