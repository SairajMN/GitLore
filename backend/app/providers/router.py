"""Provider router — routes requests to the cheapest/fastest available provider with fallback."""

import logging
from typing import Optional

from app.providers.interface import (
    LLMProvider, GenerateTextOptions, GenerateTextResult,
    StructuredExtractOptions, StructuredExtractResult,
)
from app.providers.groq_adapter import GroqProvider
from app.providers.openrouter_adapter import OpenRouterProvider
from app.providers.inception_adapter import InceptionProvider
from app.config import get_settings

logger = logging.getLogger(__name__)


def _parse_model_ref(ref: str) -> tuple[str, str]:
    """Parse 'provider:model_name' into (provider_name, model_name)."""
    if ":" in ref:
        parts = ref.split(":", 1)
        return parts[0], parts[1]
    return "", ref


class ProviderRouter:
    """Routes LLM requests to the best available provider with automatic fallback."""

    def __init__(self):
        self._providers: dict[str, LLMProvider] = {
            "groq": GroqProvider(),
            "openrouter": OpenRouterProvider(),
            "inception": InceptionProvider(),
        }
        self._settings = get_settings()

    def _get_provider(self, name: str) -> Optional[LLMProvider]:
        provider = self._providers.get(name)
        if provider and provider.is_available():
            return provider
        return None

    def _get_fallback_chain(self, preferred_provider: str) -> list[LLMProvider]:
        """Build fallback chain starting with preferred provider."""
        chain = []
        p = self._get_provider(preferred_provider)
        if p:
            chain.append(p)
        for name, provider in self._providers.items():
            if name != preferred_provider and provider.is_available():
                chain.append(provider)
        return chain

    async def generate_text(
        self,
        options: GenerateTextOptions,
        model_override: Optional[str] = None,
    ) -> GenerateTextResult:
        """Generate text with automatic fallback across providers."""
        if model_override:
            provider_name, model_name = _parse_model_ref(model_override)
        elif options.model:
            provider_name, model_name = _parse_model_ref(options.model)
        else:
            provider_name = ""
            model_name = ""

        chain = self._get_fallback_chain(provider_name)

        if not chain:
            raise RuntimeError("No LLM providers available. Check API keys in .env")

        last_error = None
        for provider in chain:
            try:
                opts = GenerateTextOptions(
                    prompt=options.prompt,
                    model=model_name or None,
                    temperature=options.temperature,
                    max_tokens=options.max_tokens,
                    system=options.system,
                )
                result = await provider.generate_text(opts)
                return result
            except Exception as e:
                last_error = e
                logger.warning("provider=%s failed: %s, trying next", provider.name, e)
                continue

        raise RuntimeError(f"All providers failed. Last error: {last_error}")

    async def extract_structured(
        self,
        options: StructuredExtractOptions,
        model_override: Optional[str] = None,
    ) -> StructuredExtractResult:
        """Extract structured data with automatic fallback."""
        if model_override:
            provider_name, model_name = _parse_model_ref(model_override)
        else:
            provider_name, model_name = _parse_model_ref(options.model)

        chain = self._get_fallback_chain(provider_name)

        if not chain:
            raise RuntimeError("No LLM providers available")

        last_error = None
        for provider in chain:
            try:
                opts = StructuredExtractOptions(
                    text=options.text,
                    schema=options.schema,
                    instructions=options.instructions,
                    model=model_name,
                )
                result = await provider.extract_structured(opts)
                return result
            except Exception as e:
                last_error = e
                logger.warning("provider=%s extract failed: %s", provider.name, e)
                continue

        raise RuntimeError(f"All providers failed for extraction. Last error: {last_error}")

    def available_providers(self) -> list[str]:
        """Return list of available provider names."""
        return [name for name, p in self._providers.items() if p.is_available()]


_router: Optional[ProviderRouter] = None


def get_provider_router() -> ProviderRouter:
    global _router
    if _router is None:
        _router = ProviderRouter()
    return _router
