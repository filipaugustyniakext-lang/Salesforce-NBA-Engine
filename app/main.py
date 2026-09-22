"""FastAPI application exposing the Next Best Action engine.

Endpoints:
    GET  /health                       -> liveness probe
    GET  /api/customers                -> list sample customer accounts
    GET  /api/customers/{id}/recommend -> recommendations for a sample account
    POST /api/recommend                -> recommendations for an ad-hoc profile
    GET  /                             -> minimal single-page demo UI
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .data import SAMPLE_CUSTOMERS, list_sample_customers
from .engine import NBAEngine
from .models import CustomerProfile, RecommendationResponse

app = FastAPI(
    title="Salesforce NBA Engine",
    description="A rule-based Next Best Action recommendation engine.",
    version=__version__,
)

engine = NBAEngine()

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/health")
def health() -> dict[str, str]:
    """Simple liveness/readiness probe."""
    return {"status": "ok", "version": __version__}


@app.get("/api/customers")
def get_customers() -> list[CustomerProfile]:
    """Return the built-in sample customer accounts."""
    return list_sample_customers()


@app.get("/api/customers/{customer_id}/recommend", response_model=RecommendationResponse)
def recommend_for_sample(
    customer_id: str,
    limit: int = Query(3, ge=1, le=10),
) -> RecommendationResponse:
    """Return next best actions for one of the built-in sample accounts."""
    customer = SAMPLE_CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail=f"Unknown customer '{customer_id}'.")
    recs = engine.recommend(customer, limit=limit)
    return RecommendationResponse(
        customer_id=customer_id,
        generated_count=len(recs),
        recommendations=recs,
    )


@app.post("/api/recommend", response_model=RecommendationResponse)
def recommend_for_profile(
    customer: CustomerProfile,
    limit: int = Query(3, ge=1, le=10),
) -> RecommendationResponse:
    """Return next best actions for an arbitrary customer profile."""
    recs = engine.recommend(customer, limit=limit)
    return RecommendationResponse(
        customer_id=customer.customer_id,
        generated_count=len(recs),
        recommendations=recs,
    )


@app.get("/")
def index() -> FileResponse:
    """Serve the single-page demo UI."""
    return FileResponse(STATIC_DIR / "index.html")


# Mount remaining static assets (kept after routes so "/" resolves to the UI).
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
