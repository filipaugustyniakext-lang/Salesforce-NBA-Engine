"""API-level tests exercising the FastAPI endpoints end to end."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_list_customers():
    res = client.get("/api/customers")
    assert res.status_code == 200
    customers = res.json()
    assert len(customers) == 4
    assert {c["customer_id"] for c in customers} == {"acme", "globex", "initech", "hooli"}


def test_recommend_sample_customer():
    res = client.get("/api/customers/globex/recommend?limit=3")
    assert res.status_code == 200
    body = res.json()
    assert body["customer_id"] == "globex"
    assert body["generated_count"] == len(body["recommendations"])
    assert len(body["recommendations"]) <= 3
    assert body["recommendations"][0]["action_id"] == "retention_offer"


def test_recommend_unknown_customer_404():
    res = client.get("/api/customers/does-not-exist/recommend")
    assert res.status_code == 404


def test_recommend_ad_hoc_profile():
    payload = {
        "customer_id": "custom-1",
        "name": "Custom Co",
        "plan_tier": "professional",
        "tenure_months": 12,
        "monthly_spend": 900.0,
        "seats_used": 40,
        "seats_licensed": 45,
        "usage_score": 0.75,
        "churn_risk": 0.2,
        "open_support_tickets": 0,
        "nps": 50,
    }
    res = client.post("/api/recommend?limit=3", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["customer_id"] == "custom-1"
    assert body["recommendations"]


def test_recommend_validation_error():
    """churn_risk out of range should be rejected by the model."""
    payload = {
        "customer_id": "bad",
        "name": "Bad Co",
        "plan_tier": "free",
        "tenure_months": 1,
        "monthly_spend": 0,
        "seats_used": 1,
        "seats_licensed": 1,
        "usage_score": 0.5,
        "churn_risk": 5.0,
        "open_support_tickets": 0,
    }
    res = client.post("/api/recommend", json=payload)
    assert res.status_code == 422


def test_index_served():
    res = client.get("/")
    assert res.status_code == 200
    assert "Salesforce NBA Engine" in res.text
