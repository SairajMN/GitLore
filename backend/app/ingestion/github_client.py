"""GitHub API client using httpx for fetching repository artifacts."""

import httpx
import logging
from typing import Optional
from app.config import get_settings

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com"


class GitHubClient:
    """Async GitHub API client for fetching commits, PRs, issues, and docs."""

    def __init__(self, token: Optional[str] = None):
        settings = get_settings()
        self.token = token or settings.github_token
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            self.headers["Authorization"] = f"Bearer {self.token}"

    async def get_repo_info(self, owner: str, name: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{GITHUB_API}/repos/{owner}/{name}", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def get_commits(self, owner: str, name: str, sha: str = "main", per_page: int = 100) -> list[dict]:
        commits = []
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while page <= 10:  # Max 10 pages
                resp = await client.get(
                    f"{GITHUB_API}/repos/{owner}/{name}/commits",
                    headers=self.headers,
                    params={"sha": sha, "per_page": per_page, "page": page},
                )
                resp.raise_for_status()
                data = resp.json()
                if not data:
                    break
                commits.extend(data)
                if len(data) < per_page:
                    break
                page += 1
        return commits

    async def get_pull_requests(self, owner: str, name: str, state: str = "all", per_page: int = 100) -> list[dict]:
        prs = []
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while page <= 10:
                resp = await client.get(
                    f"{GITHUB_API}/repos/{owner}/{name}/pulls",
                    headers=self.headers,
                    params={"state": state, "per_page": per_page, "page": page, "sort": "updated"},
                )
                resp.raise_for_status()
                data = resp.json()
                if not data:
                    break
                prs.extend(data)
                if len(data) < per_page:
                    break
                page += 1
        return prs

    async def get_issues(self, owner: str, name: str, state: str = "all", per_page: int = 100) -> list[dict]:
        issues = []
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while page <= 10:
                resp = await client.get(
                    f"{GITHUB_API}/repos/{owner}/{name}/issues",
                    headers=self.headers,
                    params={"state": state, "per_page": per_page, "page": page, "sort": "updated"},
                )
                resp.raise_for_status()
                data = resp.json()
                if not data:
                    break
                issues.extend(data)
                if len(data) < per_page:
                    break
                page += 1
        return issues

    async def get_releases(self, owner: str, name: str, per_page: int = 50) -> list[dict]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{name}/releases",
                headers=self.headers,
                params={"per_page": per_page},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_file_content(self, owner: str, name: str, path: str, ref: str = "main") -> Optional[str]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{name}/contents/{path}",
                headers=self.headers,
                params={"ref": ref},
            )
            if resp.status_code == 200:
                import base64
                data = resp.json()
                if data.get("encoding") == "base64":
                    return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            return None

    async def get_readme(self, owner: str, name: str) -> Optional[str]:
        return await self.get_file_content(owner, name, "README.md")

    async def get_adrs(self, owner: str, name: str) -> list[dict]:
        """Try to fetch ADRs from common locations."""
        adr_paths = ["docs/adr", "adr", "doc/adr", "docs/architecture-decisions"]
        adrs = []
        for adr_path in adr_paths:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(
                        f"{GITHUB_API}/repos/{owner}/{name}/contents/{adr_path}",
                        headers=self.headers,
                    )
                    if resp.status_code == 200:
                        for item in resp.json():
                            if item.get("name", "").endswith(".md"):
                                content = await self.get_file_content(owner, name, item["path"])
                                adrs.append({"path": item["path"], "content": content, "name": item["name"]})
            except Exception:
                continue
        return adrs
