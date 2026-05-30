"""OpenRouter provider adapter — broad model access, mid-range cost."""

import time
import httpx
import json
import logging

from app.providers.interface import (
    LLMProvider, GenerateTextOptions, GenerateTextResult,
    StructuredExtractOptions, StructuredExtractResult,
)
from app.config import get_settings

logger = logging.getLogger(__name__)


class OpenRouterProvider(LLMProvider):
    def __init__(self):
        self._settings = get_settings()

    @property
    def name(self) -> str:
        return "openrouter"

    def is_available(self) -> bool:
        return bool(self._settings.openrouter_api_key)

    async def generate_text(self, options: GenerateTextOptions) -> GenerateTextResult:
        model = options.model or "meta-llama/llama-3.1-70b-instruct"
        url = f"{self._settings.openrouter_base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://gitlore.dev",
            "X-Title": "GitLore",
        }
        messages = []
        if options.system:
            messages.append({"role": "system", "content": options.system})
        messages.append({"role": "user", "content": options.prompt})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": options.temperature,
            "max_tokens": options.max_tokens,
        }

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        latency_ms = int((time.monotonic() - start) * 1000)
        text = data["choices"][0]["message"]["content"]
        tokens = data.get("usage", {}).get("total_tokens")

        logger.info("openrouter.generate_text model=%s latency_ms=%d tokens=%s", model, latency_ms, tokens)
        return GenerateTextResult(text=text, model=model, provider="openrouter", latency_ms=latency_ms, tokens_used=tokens)

    async def extract_structured(self, options: StructuredExtractOptions) -> StructuredExtractResult:
        system_prompt = (
            f"You are a structured data extractor.\n"
            f"Instructions: {options.instructions}\n"
            f"Return ONLY valid JSON matching this schema: {json.dumps(options.schema)}"
        )
        result = await self.generate_text(GenerateTextOptions(
            prompt=options.text,
            model=options.model,
            system=system_prompt,
            temperature=0.0,
        ))

        try:
            parsed = json.loads(result.text.strip().removeprefix("```json").removesuffix("```").strip())
        except json.JSONDecodeError:
            logger.warning("openrouter.extract_structured: failed to parse JSON")
            parsed = {}

        return StructuredExtractResult(data=parsed, model=result.model, provider="openrouter")