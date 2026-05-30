"""Tests for retrieval and query interpretation."""

import pytest
from app.services.query_interpreter import (
    classify_intent_local, extract_entities_local,
    extract_search_terms, extract_time_hints,
)
from app.retrieval.retrieval_orchestrator import extract_entities


def test_classify_why():
    intent, conf = classify_intent_local("Why does this function still support the old format?")
    assert intent == "why"
    assert conf > 0.5


def test_classify_when():
    intent, conf = classify_intent_local("When was this edge case introduced?")
    assert intent == "when"
    assert conf > 0.5


def test_classify_dependency():
    intent, conf = classify_intent_local("What dependency caused the build to break?")
    assert intent == "dependency"


def test_extract_entities():
    entities = extract_entities_local("Why does #123 reference commit abc1234?")
    types = {e["type"] for e in entities}
    assert "issue_or_pr" in types
    assert "commit_hash" in types


def test_extract_search_terms():
    terms = extract_search_terms("Why does this function still support the old format?")
    assert "function" not in terms or len(terms) > 0
    assert len(terms) >= 1


def test_extract_time_hints():
    hints = extract_time_hints("What changed after 2024-01-15?")
    assert "date" in hints
    assert hints["date"] == "2024-01-15"


def test_extract_entities_full():
    result = extract_entities("Fix #456 in main.py")
    assert "entities" in result
    assert "search_terms" in result
