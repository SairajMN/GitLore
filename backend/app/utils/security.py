"""Security utilities — audit logging, access control helpers."""

import logging
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import AuditLog

logger = logging.getLogger(__name__)


async def log_audit(
    session: AsyncSession,
    action: str,
    repo_id: UUID | None = None,
    details: dict | None = None,
    performed_by: str | None = None,
    ip_address: str | None = None,
):
    """Write an audit log entry."""
    audit = AuditLog(
        repository_id=repo_id,
        action=action,
        details=details or {},
        performed_by=performed_by,
        ip_address=ip_address,
    )
    session.add(audit)
    logger.info("audit action=%s repo=%s by=%s", action, repo_id, performed_by)
