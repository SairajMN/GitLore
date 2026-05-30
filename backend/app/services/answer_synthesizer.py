"""Answer synthesis service — generates grounded answers from evidence packs."""

import time
import json
import logging
from dataclasses import dataclass, field

from app.providers.interface import GenerateTextOptions
from app.providers.router import get_provider_router
from app.services.evidence_builder import EvidencePack

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are GitLore, a repository archaeology assistant. You explain WHY code exists by analyzing historical evidence from commits, PRs, issues, and documentation.

RULES:
1. Start with a direct answer to the question.
2. Cite specific evidence (commits, PRs, issues) with links when available.
3. Distinguish explicit evidence from inference.
4. If evidence is weak or missing, say so explicitly.
5. Never fabricate historical rationale.
6. If multiple explanations are plausible, present ranked hypotheses.
7. Be concise and factual.

FORMAT:
- Direct answer (1-3 sentences)
- Evidence trail (bullet points with citations)
- Confidence assessment
- Uncertainty notes if applicable"""


@dataclass
class SynthesisResult:
    answer_text: str
    confidence: float
    uncertainty_notes: str
    model_used: str
    latency_ms: int
    hypotheses: list[dict] = field(default_factory=list)


class AnswerSynthesizer:
    """Synthesizes grounded answers from evidence packs using LLM providers."""

    def __init__(self):
        self.router = get_provider_router()

    async def synthesize(
        self,
        query_text: str,
        evidence_pack: EvidencePack,
        model_override: str | None = None,
    ) -> SynthesisResult:
        """Generate a grounded answer from evidence."""
        start = time.monotonic()

        # Build the evidence context
        evidence_context = self._format_evidence(evidence_context=evidence_pack)

        user_prompt = f"""Question: {query_text}

Available Evidence ({evidence_pack.total_sources} sources, coverage: {evidence_pack.coverage}):

{evidence_context}

{self._format_gaps(evidence_pack.gaps)}

Based on this evidence, provide a grounded answer. Cite specific artifacts by title and type."""

        model = model_override or "groq:llama-3.1-8b-instant"

        try:
            result = await self.router.generate_text(
                GenerateTextOptions(
                    prompt=user_prompt,
                    system=SYSTEM_PROMPT,
                    temperature=0.2,
                    max_tokens=2048,
                ),
                model_override=model,
            )
            latency_ms = int((time.monotonic() - start) * 1000)

            # Calculate confidence from evidence quality
            confidence = self._compute_confidence(evidence_pack)

            # Extract uncertainty notes
            uncertainty = self._extract_uncertainty(result.text, evidence_pack)

            # Build hypotheses
            hypotheses = self._extract_hypotheses(result.text)

            return SynthesisResult(
                answer_text=result.text,
                confidence=confidence,
                uncertainty_notes=uncertainty,
                model_used=f"{result.provider}:{result.model}",
                latency_ms=latency_ms,
                hypotheses=hypotheses,
            )

        except Exception as e:
            logger.error("Answer synthesis failed: %s", e)
            latency_ms = int((time.monotonic() - start) * 1000)
            return SynthesisResult(
                answer_text=self._fallback_answer(query_text, evidence_pack),
                confidence=0.1,
                uncertainty_notes=f"LLM synthesis failed: {e}. Showing evidence-based fallback.",
                model_used="fallback",
                latency_ms=latency_ms,
            )

    def _format_evidence(self, evidence_context: EvidencePack) -> str:
        lines = []
        for i, entry in enumerate(evidence_context.entries, 1):
            lines.append(f"[{i}] ({entry.artifact_type.upper()}) {entry.artifact_title}")
            lines.append(f"    Claim: {entry.claim}")
            lines.append(f"    Excerpt: {entry.excerpt[:200]}")
            if entry.artifact_url:
                lines.append(f"    URL: {entry.artifact_url}")
            lines.append(f"    Relevance: {entry.relevance_score:.2f}")
            lines.append("")
        return "\n".join(lines)

    def _format_gaps(self, gaps: list[str]) -> str:
        if not gaps:
            return ""
        return "\nGaps in evidence:\n" + "\n".join(f"- {g}" for g in gaps)

    def _compute_confidence(self, pack: EvidencePack) -> float:
        if pack.coverage == "sufficient":
            base = 0.7
        elif pack.coverage == "partial":
            base = 0.4
        else:
            base = 0.15

        direct_count = sum(1 for e in pack.entries if e.is_direct)
        high_rel = sum(1 for e in pack.entries if e.relevance_score >= 0.5)
        return min(base + direct_count * 0.05 + high_rel * 0.03, 0.95)

    def _extract_uncertainty(self, answer: str, pack: EvidencePack) -> str:
        notes = []
        if pack.coverage == "insufficient":
            notes.append("Evidence coverage is insufficient — answer may be incomplete.")
        if pack.coverage == "partial":
            notes.append("Some evidence gaps exist.")
        if len(pack.entries) < 3:
            notes.append("Limited sources available for this answer.")
        return " ".join(notes) if notes else ""

    def _extract_hypotheses(self, answer: str) -> list[dict]:
        hypotheses = []
        lines = answer.split("\n")
        rank = 1
        for line in lines:
            line = line.strip()
            if line.startswith("- ") or line.startswith("* ") or (len(line) > 10 and ":" in line):
                text = line.lstrip("-* ").strip()
                if len(text) > 20:
                    hypotheses.append({
                        "rank": rank,
                        "explanation": text[:300],
                        "confidence": max(0.3, 0.8 - rank * 0.15),
                        "evidence_ids": [],
                    })
                    rank += 1
                    if rank > 3:
                        break
        return hypotheses

    def _fallback_answer(self, query: str, pack: EvidencePack) -> str:
        if not pack.entries:
            return (
                f"**Unable to provide a grounded answer.**\n\n"
                f"No relevant evidence was found for: {query}\n\n"
                f"This could mean the repository hasn't been fully indexed, "
                f"or the query targets code/history not yet captured."
            )

        lines = [
            f"Based on available evidence ({len(pack.entries)} sources, {pack.coverage} coverage):\n",
        ]
        for i, entry in enumerate(pack.entries[:5], 1):
            lines.append(f"**{i}. {entry.artifact_title}** ({entry.artifact_type})")
            lines.append(f"   {entry.claim}")
            lines.append(f"   Excerpt: {entry.excerpt[:150]}")
            if entry.artifact_url:
                lines.append(f"   Source: {entry.artifact_url}")
            lines.append("")

        lines.append("*Note: This is an evidence-based summary, not an LLM-synthesized answer.*")
        return "\n".join(lines)