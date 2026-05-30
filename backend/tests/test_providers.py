"""Tests for provider abstraction layer."""

import pytest
from app.providers.interface import GenerateTextOptions, LLMProvider
from app.providers.router import _parse_model_ref, get_provider_router


def test_parse_model_ref_with_provider():
    provider, model = _parse_model_ref("groq:llama-3.1-8b-instant")
    assert provider == "groq"
    assert model == "llama-3.1-8b-instant"


def test_parse_model_ref_without_provider():
    provider, model = _parse_model_ref("meta-llama/llama-3.1-70b-instruct")
    assert provider == ""
    assert model == "meta-llama/llama-3.1-70b-instruct"


def test_parse_model_ref_single():
    provider, model = _parse_model_ref("model-name")
    assert provider == ""
    assert model == "model-name"


def test_provider_router_initializes():
    router = get_provider_router()
    assert router is not None
    assert isinstance(router.available_providers(), list)
