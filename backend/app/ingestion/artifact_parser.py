"""Parses raw GitHub API responses into normalized artifact dicts."""

from datetime import datetime
from typing import Optional


def parse_commit(raw: dict, repo_url: str = "") -> dict:
    """Parse a GitHub commit into artifact data."""
    commit_data = raw.get("commit", {})
    sha = raw.get("sha", "")
    return {
        "artifact_type": "commit",
        "external_id": sha,
        "title": commit_data.get("message", "").split("\n")[0][:500] if commit_data.get("message") else None,
        "description": commit_data.get("message", "")[:5000] if commit_data.get("message") else None,
        "content": commit_data.get("message", ""),
        "author": commit_data.get("author", {}).get("name"),
        "date": _parse_date(commit_data.get("author", {}).get("date")),
        "url": f"{repo_url}/commit/{sha}" if repo_url else None,
        "metadata_": {
            "sha": sha,
            "parents": [p.get("sha") for p in raw.get("parents", [])],
            "files_changed": raw.get("stats", {}),
        },
    }


def parse_pull_request(raw: dict, repo_url: str = "") -> dict:
    """Parse a GitHub PR into artifact data."""
    return {
        "artifact_type": "pr",
        "external_id": str(raw.get("number", "")),
        "title": (raw.get("title") or "")[:500],
        "description": (raw.get("body") or "")[:5000],
        "content": raw.get("body") or "",
        "author": raw.get("user", {}).get("login"),
        "date": _parse_date(raw.get("created_at")),
        "url": raw.get("html_url") or f"{repo_url}/pull/{raw.get('number')}",
        "metadata_": {
            "state": raw.get("state"),
            "merged": raw.get("merged"),
            "merged_at": raw.get("merged_at"),
            "merged_by": raw.get("merged_by", {}).get("login") if raw.get("merged_by") else None,
            "head": raw.get("head", {}).get("ref"),
            "base": raw.get("base", {}).get("ref"),
            "additions": raw.get("additions"),
            "deletions": raw.get("deletions"),
            "changed_files": raw.get("changed_files"),
        },
    }


def parse_issue(raw: dict, repo_url: str = "") -> dict:
    """Parse a GitHub issue into artifact data."""
    return {
        "artifact_type": "issue",
        "external_id": str(raw.get("number", "")),
        "title": (raw.get("title") or "")[:500],
        "description": (raw.get("body") or "")[:5000],
        "content": raw.get("body") or "",
        "author": raw.get("user", {}).get("login"),
        "date": _parse_date(raw.get("created_at")),
        "url": raw.get("html_url") or f"{repo_url}/issues/{raw.get('number')}",
        "metadata_": {
            "state": raw.get("state"),
            "labels": [l.get("name") for l in raw.get("labels", [])],
            "assignees": [a.get("login") for a in raw.get("assignees", [])],
            "comments": raw.get("comments"),
        },
    }


def parse_release(raw: dict, repo_url: str = "") -> dict:
    """Parse a GitHub release into artifact data."""
    return {
        "artifact_type": "release_note",
        "external_id": str(raw.get("id", "")),
        "title": (raw.get("name") or raw.get("tag_name") or "")[:500],
        "description": (raw.get("body") or "")[:5000],
        "content": raw.get("body") or "",
        "author": raw.get("author", {}).get("login"),
        "date": _parse_date(raw.get("published_at") or raw.get("created_at")),
        "url": raw.get("html_url"),
        "metadata_": {
            "tag": raw.get("tag_name"),
            "prerelease": raw.get("prerelease"),
            "draft": raw.get("draft"),
        },
    }


def parse_doc(path: str, content: str) -> dict:
    """Parse a documentation file into artifact data."""
    name = path.split("/")[-1] if "/" in path else path
    is_adr = "adr" in path.lower() or "architecture-decision" in path.lower()
    return {
        "artifact_type": "adr" if is_adr else "doc",
        "external_id": path,
        "title": name.replace(".md", "").replace("-", " ").replace("_", " ").title()[:500],
        "description": content[:5000] if content else None,
        "content": content or "",
        "url": None,
        "metadata_": {"path": path},
    }


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    if not date_str:
        return None
    try:
        # GitHub uses ISO 8601 format
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
