"""FastAPI entrypoint for Omphalos.

Phase 0: a single /health endpoint used to prove the frontend->proxy->backend
round-trip. Bound to localhost only in dev (see README run command) because this
process holds all API keys.
"""

import logging

from fastapi import FastAPI
from pydantic import BaseModel

from .config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("omphalos")

app = FastAPI(title="Omphalos API", version="0.1.0")


class HealthResponse(BaseModel):
    """Response shape for GET /health.

    Pydantic models are the single source of truth for response shapes
    (CLAUDE.md type contract); the frontend types are generated from this.
    """

    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    logger.info("health check served")
    return HealthResponse(status="ok", service=settings.app_name, version=app.version)
