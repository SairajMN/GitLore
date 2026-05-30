"""Resolves relations between artifacts (PR fixes issue, commit references PR, etc.)."""

import re
import logging
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Relation, Artifact

logger = logging.getLogger(__name__)

# Patterns to detect cross-references
ISSUE_REF = re.compile(r"(?:closes?|fixes?|resolves?)\s+#(\d+)", re.IGNORECASE)
PR_REF = re.compile(r"(?:#(\d+))")
COMMIT_HASH = re.compile(r"\b([0-9a-f]{7,40})\b")


class RelationResolver:
    """Creates relations between artifacts based on cross-references."""

    def __init__(self, session: AsyncSession, repo_id: UUID):
        self.session = session
        self.repo_id = repo_id

    async def resolve_from_commit(self, commit_artifact: Artifact, message: str):
        """Extract relations from commit message."""
        if not message:
            return

        # Find issue/PR references
        for match in ISSUE_REF.finditer(message):
            issue_num = match.group(1)
            target = await self._find_artifact_by_external(issue_num, ["issue", "pr"])
            if target:
                await self._create_relation(
                    commit_artifact.id, target.id, "fixes",
                    {"commit_message": message[:200]}
                )

        # General PR/issue mentions
        for match in PR_REF.finditer(message):
            num = match.group(1)
            target = await self._find_artifact_by_external(num, ["pr", "issue"])
            if target and target.id != commit_artifact.id:
                await self._create_relation(
                    commit_artifact.id, target.id, "references",
                    {"context": "commit_message"}
                )

    async def resolve_from_pr(self, pr_artifact: Artifact, body: str, merged: bool = False):
        """Extract relations from PR body."""
        if not body:
            return

        for match in ISSUE_REF.finditer(body):
            issue_num = match.group(1)
            target = await self._find_artifact_by_external(issue_num, ["issue"])
            if target:
                rel_type = "fixes" if merged else "discusses"
                await self._create_relation(
                    pr_artifact.id, target.id, rel_type,
                    {"pr_merged": merged}
                )

    async def resolve_from_issue(self, issue_artifact: Artifact, body: str):
        """Extract relations from issue body."""
        if not body:
            return

        for match in PR_REF.finditer(body):
            num = match.group(1)
            target = await self._find_artifact_by_external(num, ["pr"])
            if target:
                await self._create_relation(
                    issue_artifact.id, target.id, "discusses",
                    {"source": "issue_body"}
                )

    async def _find_artifact_by_external(self, external_id: str, artifact_types: list[str]) -> Optional[Artifact]:
        stmt = select(Artifact).where(
            Artifact.repository_id == self.repo_id,
            Artifact.external_id == str(external_id),
            Artifact.artifact_type.in_(artifact_types),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def _create_relation(self, source_id: UUID, target_id: UUID, rel_type: str, metadata: dict = None):
        """Create a relation if it doesn't already exist."""
        existing = await self.session.execute(
            select(Relation).where(
                Relation.source_id == source_id,
                Relation.target_id == target_id,
                Relation.relation_type == rel_type,
            )
        )
        if existing.scalar_one_or_none():
            return

        relation = Relation(
            source_id=source_id,
            target_id=target_id,
            relation_type=rel_type,
            metadata_=metadata or {},
        )
        self.session.add(relation)
