"""Evidence pack builder — scores, selects, excerpts, and classifies evidence."""

import re
import logging
from dataclasses import dataclass, field

from app.db.models import Artifact

logger = logging.getLogger(__name__)

RATIONALE_KEYWORDS = {
    "because", "since", "due to", "reason", "rationale", "workaround",
    "legacy", "backward", "compatibility", "deprecat", "migrate",
    "issue", "bug", "fix", "patch", "hotfix", "regression", "edge case",
    "tradeoff", "trade-off", "decision", "adr", "consensus",
}


@dataclass
class EvidenceEntry:
    artifact_id: str
    artifact_type: str
    artifact_title: str
    artifact_url: str
    artifact_date: str
    relevance_score: float
    excerpt: str
    claim: str
    is_direct: bool


@dataclass
class EvidencePack:
    entries: list[EvidenceEntry] = field(default_factory=list)
    coverage: str = "insufficient"
    gaps: list[str] = field(default_factory=list)
    total_sources: int = 0


class EvidencePackBuilder:
    def build(self, artifacts: list[Artifact], scores: dict, sources: dict, query_text: str) -> EvidencePack:
        pack = EvidencePack()
        if not artifacts:
            pack.gaps.append("No artifacts found matching the query")
            return pack

        candidates = []
        for artifact in artifacts:
            aid = str(artifact.id)
            base_score = scores.get(aid, 0.5)
            combined = self._compute_score(artifact, base_score, query_text)
            excerpt = self._extract_excerpt(artifact, query_text)
            claim = self._formulate_claim(artifact, query_text)
            candidates.append(EvidenceEntry(
                artifact_id=aid, artifact_type=artifact.artifact_type,
                artifact_title=artifact.title or "Untitled",
                artifact_url=artifact.url or "",
                artifact_date=str(artifact.date) if artifact.date else "",
                relevance_score=combined, excerpt=excerpt, claim=claim,
                is_direct=sources.get(aid, "") == "exact_match",
            ))

        candidates.sort(key=lambda x: x.relevance_score, reverse=True)
        selected = candidates[:12]
        if len(selected) > 3 and selected[-1].relevance_score < 0.2:
            selected = [e for e in selected if e.relevance_score >= 0.2][:max(3, len(candidates))]

        pack.entries = selected
        pack.total_sources = len(candidates)
        direct_count = sum(1 for e in selected if e.is_direct)
        high_relevance = sum(1 for e in selected if e.relevance_score >= 0.5)

        if direct_count >= 1 and high_relevance >= 2:
            pack.coverage = "sufficient"
        elif len(selected) >= 2:
            pack.coverage = "partial"
        else:
            pack.coverage = "insufficient"

        types = {e.artifact_type for e in selected}
        if "pr" not in types and "issue" not in types:
            pack.gaps.append("No pull requests or issues found")
        if "commit" not in types:
            pack.gaps.append("No commit history found")
        return pack

    def _compute_score(self, artifact: Artifact, base: float, query: str) -> float:
        score = base
        if artifact.artifact_type in ("pr", "issue"):
            score += 0.15
        if artifact.artifact_type == "adr":
            score += 0.2
        text = f"{artifact.title or ''} {artifact.content or ''}".lower()
        for kw in RATIONALE_KEYWORDS:
            if kw in text:
                score += 0.05
        if artifact.title:
            terms = [t for t in query.split() if len(t) > 3]
            if any(t.lower() in artifact.title.lower() for t in terms):
                score += 0.1
        if artifact.metadata_ and artifact.metadata_.get("merged"):
            score += 0.1
        return min(score, 1.0)

    def _extract_excerpt(self, artifact: Artifact, query: str, max_len: int = 300) -> str:
        content = artifact.content or artifact.description or artifact.title or ""
        if not content:
            return ""
        paras = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()] or [content]
        query_terms = set(query.lower().split())
        best = max(paras, key=lambda p: sum(1 for t in query_terms if t in p.lower()))
        return best[:max_len] + "..." if len(best) > max_len else best

    def _formulate_claim(self, artifact: Artifact, query: str) -> str:
        claims = {
            "commit": f"Commit '{artifact.title}' shows a code change",
            "pr": f"Pull request '{artifact.title}' represents a proposed change",
            "issue": f"Issue '{artifact.title}' discusses a topic",
            "adr": f"Architecture decision record '{artifact.title}' documents a decision",
            "doc": f"Documentation '{artifact.title}' provides context",
            "release_note": f"Release '{artifact.title}' announces changes",
        }
        return claims.get(artifact.artifact_type, f"Artifact '{artifact.title}' provides information")