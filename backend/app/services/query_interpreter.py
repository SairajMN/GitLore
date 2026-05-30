"""Query interpreter — classifies query intent and extracts entities."""

import re
import json
import logging
from dataclasses import dataclass

from app.providers.interface import GenerateTextOptions
from app.providers.router import get_provider_router

logger = logging.getLogger(__name__)

WHY_PAT = re.compile(r"\b(why|reason|rationale|purpose|explain|justify)\b", re.I)
WHEN_PAT = re.compile(r"\b(when|date|introduced|added|changed|removed|first|last)\b", re.I)
CHANGED_PAT = re.compile(r"\b(changed|modified|updated|diff|between|before|after)\b", re.I)
DEP_PAT = re.compile(r"\b(depend\w*|require\w*|import\w*|package|library|version|dependency)\b", re.I)
EDGE_PAT = re.compile(r"\b(edge.?case|special.?case|workaround|hack|legacy|compat|fallback)\b", re.I)
RAT_PAT = re.compile(r"\b(trade.?off|decision|chose|selected|picked|vs\.?|versus)\b", re.I)


@dataclass
class QueryInterpretation:
    intent: str
    entities: list[dict]
    time_hints: dict
    search_terms: list[str]
    confidence: float


def classify_intent_local(text: str) -> tuple[str, float]:
    scores = {
        "why": len(WHY_PAT.findall(text)),
        "when": len(WHEN_PAT.findall(text)),
        "what_changed": len(CHANGED_PAT.findall(text)),
        "dependency": len(DEP_PAT.findall(text)),
        "edge_case": len(EDGE_PAT.findall(text)),
        "rationale": len(RAT_PAT.findall(text)),
    }
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "unknown", 0.3
    total = sum(scores.values())
    confidence = min(0.5 + (scores[best] / max(total, 1)) * 0.4, 0.9)
    return best, confidence


def extract_entities_local(text: str) -> list[dict]:
    entities = []
    for m in re.finditer(r"#(\d+)", text):
        entities.append({"type": "issue_or_pr", "value": m.group(1)})
    for m in re.finditer(r"\b([0-9a-f]{7,40})\b", text):
        entities.append({"type": "commit_hash", "value": m.group(1)})
    for m in re.finditer(r'"([^"]+)"', text):
        entities.append({"type": "symbol", "value": m.group(1)})
    for m in re.finditer(r"[\w/]+\.\w{1,5}", text):
        entities.append({"type": "file_path", "value": m.group(0)})
    for m in re.finditer(r"\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]*)+)\b", text):
        entities.append({"type": "identifier", "value": m.group(1)})
    return entities


def extract_time_hints(text: str) -> dict:
    hints = {}
    for m in re.finditer(r"\b(\d{4})-(\d{2})-(\d{2})\b", text):
        hints["date"] = m.group(0)
    return hints


def extract_search_terms(text: str) -> list[str]:
    stop = {"why","does","this","the","is","was","has","have","had","do","did","it","that",
            "what","when","where","how","which","who","still","support","code","function",
            "method","class","file","module","a","an","in","on","for","of","with","by","from",
            "as","or","and","not","be","are","were","can","could","would","should"}
    return [w for w in re.findall(r"\b[a-zA-Z]\w+\b", text.lower()) if w not in stop and len(w) > 2]


class QueryInterpreter:
    def __init__(self):
        self.router = get_provider_router()

    async def interpret(self, query_text: str) -> QueryInterpretation:
        intent, confidence = classify_intent_local(query_text)
        entities = extract_entities_local(query_text)
        time_hints = extract_time_hints(query_text)
        search_terms = extract_search_terms(query_text)

        if confidence < 0.5:
            try:
                llm_result = await self._llm_classify(query_text)
                if llm_result:
                    return llm_result
            except Exception as e:
                logger.warning("LLM classification failed: %s", e)

        return QueryInterpretation(intent=intent, entities=entities, time_hints=time_hints,
                                   search_terms=search_terms, confidence=confidence)

    async def _llm_classify(self, query_text: str) -> QueryInterpretation | None:
        prompt = f'''Classify this developer query. Return JSON with:
- intent: one of "why", "when", "what_changed", "dependency", "edge_case", "rationale", "unknown"
- entities: list of type/value pairs
- search_terms: list of 2-5 key terms
Query: "{query_text}"
Return ONLY valid JSON.'''

        result = await self.router.generate_text(
            GenerateTextOptions(prompt=prompt, temperature=0.0, max_tokens=256),
            model_override="groq:llama-3.1-8b-instant",
        )
        try:
            data = json.loads(result.text.strip().removeprefix("```json").removesuffix("```").strip())
            return QueryInterpretation(
                intent=data.get("intent", "unknown"), entities=data.get("entities", []),
                time_hints={}, search_terms=data.get("search_terms", extract_search_terms(query_text)),
                confidence=0.7,
            )
        except (json.JSONDecodeError, KeyError):
            return None
