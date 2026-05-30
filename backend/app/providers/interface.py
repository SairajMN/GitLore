"""Abstract provider interface for LLM interactions."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class GenerateTextOptions:
    prompt: str
    model: Optional[str] = None
    temperature: float = 0.3
    max_tokens: int = 4096
    system: Optional[str] = None


@dataclass
class GenerateTextResult:
    text: str
    model: str
    provider: str
    latency_ms: int
    tokens_used: Optional[int] = None


@dataclass
class StructuredExtractOptions:
    text: str
    schema: dict
    instructions: str
    model: str


@dataclass
class StructuredExtractResult:
    data: dict
    model: str
    provider: str


class LLMProvider(ABC):
    """Abstract base class for all LLM provider adapters."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    async def generate_text(self, options: GenerateTextOptions) -> GenerateTextResult:
        ...

    @abstractmethod
    async def extract_structured(self, options: StructuredExtractOptions) -> StructuredExtractResult:
        ...

    @abstractmethod
    def is_available(self) -> bool:
        ...