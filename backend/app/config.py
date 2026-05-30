"""Application configuration loaded from root .env file."""

from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    # Database — root .env has DATABASE_URL=postgresql://gitlore:gitlore@localhost:5432/gitlore
    database_url: str = "postgresql://gitlore:gitlore@localhost:5432/gitlore"
    database_url_sync: str = "postgresql://gitlore:gitlore@localhost:5432/gitlore"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # GitHub token (optional, not needed for public repos)
    github_token: str = ""

    # Provider: Groq — root .env has GROQ_API_KEY
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"

    # Provider: OpenRouter — root .env has OPENROUTER_API_KEY
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # Provider: Inception Labs — root .env has INCEPTION_API_KEY
    inception_api_key: str = ""
    inception_base_url: str = "https://api.inception.ai/v1"

    # Model routing — root .env uses:
    #   QUERY_CLASSIFICATION_MODEL -> query_classification_model
    #   EVIDENCE_SUMMARIZATION_MODEL -> evidence_summarization_model
    #   ANSWER_SYNTHESIS_MODEL -> answer_synthesis_model
    #   EMBEDDING_MODEL -> embedding_model
    query_classification_model: str = "groq:llama-3.1-8b-instant"
    evidence_summarization_model: str = "groq:llama-3.1-8b-instant"
    answer_synthesis_model: str = "openrouter:meta-llama/llama-3.1-70b-instruct"
    embedding_model: str = "openrouter:text-embedding-3-small"

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: str = "http://localhost:3000"
    log_level: str = "info"

    model_config = {
        "env_file": str(Path(__file__).resolve().parent.parent.parent / ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_async_db_url() -> str:
    """Derive async database URL from settings."""
    s = get_settings()
    url = s.database_url
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url
