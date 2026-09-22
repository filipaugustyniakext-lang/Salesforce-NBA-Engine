"""Sample customer accounts used for demos, the sample UI, and tests."""

from __future__ import annotations

from .models import CustomerProfile, PlanTier

SAMPLE_CUSTOMERS: dict[str, CustomerProfile] = {
    "acme": CustomerProfile(
        customer_id="acme",
        name="Acme Corp",
        plan_tier=PlanTier.PROFESSIONAL,
        tenure_months=26,
        monthly_spend=2400.0,
        seats_used=48,
        seats_licensed=50,
        usage_score=0.82,
        churn_risk=0.12,
        open_support_tickets=0,
        nps=60,
    ),
    "globex": CustomerProfile(
        customer_id="globex",
        name="Globex Industries",
        plan_tier=PlanTier.ENTERPRISE,
        tenure_months=40,
        monthly_spend=5200.0,
        seats_used=120,
        seats_licensed=200,
        usage_score=0.35,
        churn_risk=0.68,
        open_support_tickets=4,
        nps=-20,
    ),
    "initech": CustomerProfile(
        customer_id="initech",
        name="Initech LLC",
        plan_tier=PlanTier.STARTER,
        tenure_months=2,
        monthly_spend=180.0,
        seats_used=3,
        seats_licensed=10,
        usage_score=0.22,
        churn_risk=0.30,
        open_support_tickets=1,
        nps=None,
    ),
    "hooli": CustomerProfile(
        customer_id="hooli",
        name="Hooli",
        plan_tier=PlanTier.FREE,
        tenure_months=6,
        monthly_spend=0.0,
        seats_used=9,
        seats_licensed=10,
        usage_score=0.71,
        churn_risk=0.25,
        open_support_tickets=0,
        nps=40,
    ),
}


def list_sample_customers() -> list[CustomerProfile]:
    """Return the sample customers as a list, ordered by name."""
    return sorted(SAMPLE_CUSTOMERS.values(), key=lambda c: c.name)
