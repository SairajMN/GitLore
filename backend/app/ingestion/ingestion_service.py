"""Main ingestion service — orchestrates fetching, parsing, and storing repository artifacts."""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Repository, Artifact, CodeSymbol, IndexingJob
from app.ingestion.github_client import GitHubClient
from app.ingestion.artifact_parser import (
    parse_commit, parse_pull_request, parse_issue, parse_release, parse_doc
)
from app.ingestion.symbol_extractor import extract_symbols
from app.ingestion.relation_resolver import RelationResolver

logger = logging.getLogger(__name__)


class IngestionService:
    """Orchestrates ingestion of GitHub repository artifacts into the database."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def ingest_repo(
        self,
        repo_id: UUID,
        owner: str,
        name: str,
        branch: str = "main",
        token: Optional[str] = None,
    ) -> dict:
        """Full ingestion pipeline for a repository."""
        client = GitHubClient(token)
        repo_url = f"https://github.com/{owner}/{name}"
        counts = {"commit": 0, "pr": 0, "issue": 0, "release_note": 0, "doc": 0, "adr": 0}

        try:
            # 1. Fetch and store commits
            logger.info("Ingesting commits for %s/%s", owner, name)
            commits = await client.get_commits(owner, name, sha=branch, per_page=50)
            for raw in commits:
                data = parse_commit(raw, repo_url)
                artifact = await self._upsert_artifact(repo_id, data)
                if artifact:
                    counts["commit"] += 1
                    # Extract symbols from commit message (limited)
                    await self._resolve_relations_from_commit(artifact, data)

            # 2. Fetch and store PRs
            logger.info("Ingesting PRs for %s/%s", owner, name)
            prs = await client.get_pull_requests(owner, name)
            for raw in prs:
                data = parse_pull_request(raw, repo_url)
                artifact = await self._upsert_artifact(repo_id, data)
                if artifact:
                    counts["pr"] += 1
                    resolver = RelationResolver(self.session, repo_id)
                    await resolver.resolve_from_pr(artifact, data.get("content", ""), data["metadata_"].get("merged", False))

            # 3. Fetch and store issues
            logger.info("Ingesting issues for %s/%s", owner, name)
            issues = await client.get_issues(owner, name)
            for raw in issues:
                if raw.get("pull_request"):
                    continue  # Skip PRs that show up in issues endpoint
                data = parse_issue(raw, repo_url)
                artifact = await self._upsert_artifact(repo_id, data)
                if artifact:
                    counts["issue"] += 1
                    resolver = RelationResolver(self.session, repo_id)
                    await resolver.resolve_from_issue(artifact, data.get("content", ""))

            # 4. Fetch releases
            logger.info("Ingesting releases for %s/%s", owner, name)
            releases = await client.get_releases(owner, name)
            for raw in releases:
                data = parse_release(raw, repo_url)
                artifact = await self._upsert_artifact(repo_id, data)
                if artifact:
                    counts["release_note"] += 1

            # 5. Fetch README and docs
            logger.info("Ingesting docs for %s/%s", owner, name)
            readme = await client.get_readme(owner, name)
            if readme:
                data = parse_doc("README.md", readme)
                artifact = await self._upsert_artifact(repo_id, data)
                if artifact:
                    counts["doc"] += 1

            # 6. Fetch ADRs
            adrs = await client.get_adrs(owner, name)
            for adr in adrs:
                data = parse_doc(adr["path"], adr.get("content", ""))
                artifact = await self._upsert_artifact(repo_id, data)
                if artifact:
                    counts["adr"] += 1

            # 7. Update repository status
            repo = await self.session.get(Repository, repo_id)
            if repo:
                repo.is_indexed = True
                repo.last_indexed_at = datetime.utcnow()
                repo.index_version += 1

            await self.session.commit()
            logger.info("Ingestion complete for %s/%s: %s", owner, name, counts)

        except Exception as e:
            logger.error("Ingestion failed for %s/%s: %s", owner, name, e)
            await self.session.rollback()
            raise

        return counts

    async def _upsert_artifact(self, repo_id: UUID, data: dict) -> Optional[Artifact]:
        """Insert or update an artifact."""
        # Check if exists
        stmt = select(Artifact).where(
            Artifact.repository_id == repo_id,
            Artifact.artifact_type == data["artifact_type"],
            Artifact.external_id == data.get("external_id"),
        )
        result = await self.session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing
            for key, value in data.items():
                if value is not None:
                    setattr(existing, key, value)
            return existing

        artifact = Artifact(repository_id=repo_id, **data)
        self.session.add(artifact)
        await self.session.flush()  # Get the ID
        return artifact

    async def _resolve_relations_from_commit(self, artifact: Artifact, data: dict):
        """Resolve relations from commit."""
        resolver = RelationResolver(self.session, artifact.repository_id)
        await resolver.resolve_from_commit(artifact, data.get("content", ""))

    async def extract_and_store_symbols(self, repo_id: UUID):
        """Extract symbols from all code artifacts in the repo."""
        stmt = select(Artifact).where(
            Artifact.repository_id == repo_id,
            Artifact.artifact_type == "commit",
        )
        result = await self.session.execute(stmt)
        artifacts = result.scalars().all()

        for artifact in artifacts:
            if not artifact.content:
                continue
            # For commits, symbol extraction from message is limited
            # This is a placeholder for more sophisticated extraction
            pass

    async def get_latest_job(self, repo_id: UUID) -> Optional[IndexingJob]:
        stmt = select(IndexingJob).where(
            IndexingJob.repository_id == repo_id
        ).order_by(IndexingJob.created_at.desc()).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
