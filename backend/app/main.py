"""GitLore FastAPI application — repository archaeology backend."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.database import init_db
from app.utils.logging import setup_logging

settings = get_settings()
setup_logging(settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    logger.info("Starting GitLore backend...")
    await init_db()
    logger.info("Database initialized")
    yield
    logger.info("Shutting down GitLore backend...")


app = FastAPI(
    title="GitLore",
    description="Repository archaeology — the lore behind your codebase.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
from app.api.connect import router as connect_router
from app.api.query import router as query_router
from app.api.answer import router as answer_router
from app.api.feedback import router as feedback_router
from app.api.investigation import router as investigation_router
from app.api.watchlist import router as watchlist_router
from app.api.index_status import router as index_status_router

app.include_router(connect_router, prefix="/api", tags=["connect"])
app.include_router(query_router, prefix="/api", tags=["query"])
app.include_router(answer_router, prefix="/api", tags=["answer"])
app.include_router(feedback_router, prefix="/api", tags=["feedback"])
app.include_router(investigation_router, prefix="/api", tags=["investigation"])
app.include_router(watchlist_router, prefix="/api", tags=["watchlist"])
app.include_router(index_status_router, prefix="/api", tags=["index-status"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "gitlore", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.app_host, port=settings.app_port, reload=True)
