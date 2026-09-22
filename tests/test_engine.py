"""Unit tests for the rule-based NBA scoring engine."""

from __future__ import annotations

from app.data import SAMPLE_CUSTOMERS
from app.engine import NBAEngine
from app.models import ActionCategory, CustomerProfile, PlanTier

engine = NBAEngine()


def test_high_churn_account_gets_retention_first():
    """A high-churn, ticket-heavy account should be told to retain first."""
    globex = SAMPLE_CUSTOMERS["globex"]
    recs = engine.recommend(globex, limit=5)
    assert recs, "expected at least one recommendation"
    assert recs[0].action_id == "retention_offer"
    assert recs[0].category == ActionCategory.RETENTION


def test_recommendations_sorted_descending():
    for customer in SAMPLE_CUSTOMERS.values():
        recs = engine.recommend(customer, limit=10)
        scores = [r.score for r in recs]
        assert scores == sorted(scores, reverse=True)


def test_limit_is_respected():
    globex = SAMPLE_CUSTOMERS["globex"]
    assert len(engine.recommend(globex, limit=2)) <= 2
    assert len(engine.recommend(globex, limit=1)) == 1


def test_healthy_account_does_not_get_retention():
    """A happy, engaged, low-churn account should not surface a retention play."""
    acme = SAMPLE_CUSTOMERS["acme"]
    recs = engine.recommend(acme, limit=10)
    assert all(r.action_id != "retention_offer" for r in recs)


def test_high_seat_utilization_triggers_upsell():
    acme = SAMPLE_CUSTOMERS["acme"]  # 48/50 seats used
    recs = engine.recommend(acme, limit=10)
    assert any(r.action_id == "upsell_seats" for r in recs)


def test_new_low_usage_account_gets_onboarding():
    initech = SAMPLE_CUSTOMERS["initech"]  # 2 months, low usage
    recs = engine.recommend(initech, limit=10)
    assert any(r.action_id == "onboarding_call" for r in recs)


def test_every_recommendation_has_reasons():
    for customer in SAMPLE_CUSTOMERS.values():
        for rec in engine.recommend(customer, limit=10):
            assert rec.reasons, f"{rec.action_id} should explain its score"
            assert rec.score > 0


def test_all_actions_eligible_edge_profile():
    """A deliberately troubled account should still return bounded scores."""
    troubled = CustomerProfile(
        customer_id="edge",
        name="Edge Case Inc",
        plan_tier=PlanTier.FREE,
        tenure_months=1,
        monthly_spend=0.0,
        seats_used=10,
        seats_licensed=10,
        usage_score=0.0,
        churn_risk=1.0,
        open_support_tickets=9,
        nps=-100,
    )
    recs = engine.recommend(troubled, limit=10)
    assert recs
    assert all(0 < r.score <= 100 for r in recs)


def test_seat_utilization_property():
    c = SAMPLE_CUSTOMERS["globex"]  # 120/200
    assert abs(c.seat_utilization - 0.6) < 1e-9
