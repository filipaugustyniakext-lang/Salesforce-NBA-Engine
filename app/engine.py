"""The Next Best Action scoring engine.

Each action in the catalog declares an eligibility predicate and a scoring
function. Given a :class:`CustomerProfile`, the engine filters to eligible
actions, scores them, attaches human-readable reasons, and returns the ranked
list. The logic is deterministic and rule-based so results are explainable --
an important property for revenue teams acting on the recommendations.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .models import (
    ActionCategory,
    CustomerProfile,
    PlanTier,
    Recommendation,
)

# A scoring function returns (score, reasons). Returning a score of 0 or below
# effectively drops the action even if it passed the eligibility gate.
ScoreFn = Callable[[CustomerProfile], tuple[float, list[str]]]
EligibilityFn = Callable[[CustomerProfile], bool]


@dataclass(frozen=True)
class Action:
    """A candidate next best action definition."""

    action_id: str
    title: str
    category: ActionCategory
    is_eligible: EligibilityFn
    score: ScoreFn


_TIER_ORDER = {
    PlanTier.FREE: 0,
    PlanTier.STARTER: 1,
    PlanTier.PROFESSIONAL: 2,
    PlanTier.ENTERPRISE: 3,
}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _retention_offer(customer: CustomerProfile) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = customer.churn_risk * 100.0
    reasons.append(f"Churn risk is {customer.churn_risk:.0%}.")
    if customer.open_support_tickets >= 2:
        score += 10 * customer.open_support_tickets
        reasons.append(f"{customer.open_support_tickets} open support tickets add friction.")
    if customer.nps is not None and customer.nps < 0:
        score += 15
        reasons.append(f"Detractor NPS of {customer.nps}.")
    if customer.monthly_spend >= 1000:
        score += 10
        reasons.append("High-value account worth protecting.")
    return _clamp(score), reasons


def _upsell_seats(customer: CustomerProfile) -> tuple[float, list[str]]:
    reasons: list[str] = []
    utilization = customer.seat_utilization
    score = utilization * 70.0
    reasons.append(f"Seat utilization is {utilization:.0%}.")
    if customer.usage_score >= 0.6:
        score += 15
        reasons.append("Strong product engagement supports expansion.")
    if customer.churn_risk < 0.3:
        score += 10
        reasons.append("Low churn risk makes this a safe expansion play.")
    return _clamp(score), reasons


def _upgrade_tier(customer: CustomerProfile) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = customer.usage_score * 60.0
    reasons.append(f"Engagement score is {customer.usage_score:.0%}.")
    if customer.seat_utilization >= 0.8:
        score += 20
        reasons.append("Nearly all licensed seats are active.")
    if customer.plan_tier == PlanTier.FREE:
        score += 15
        reasons.append("Free-tier account with room to convert.")
    if customer.churn_risk >= 0.5:
        score -= 25
        reasons.append("Elevated churn risk dampens upgrade timing.")
    return _clamp(score), reasons


def _onboarding_call(customer: CustomerProfile) -> tuple[float, list[str]]:
    reasons: list[str] = []
    ramp = max(0.0, 1.0 - customer.usage_score)
    score = ramp * 80.0
    reasons.append(f"Only {customer.usage_score:.0%} engagement during ramp-up.")
    if customer.tenure_months <= 3:
        score += 15
        reasons.append(f"New account ({customer.tenure_months} months old).")
    return _clamp(score), reasons


def _adoption_nudge(customer: CustomerProfile) -> tuple[float, list[str]]:
    reasons: list[str] = []
    gap = max(0.0, 0.7 - customer.usage_score)
    score = gap * 90.0
    reasons.append(f"Engagement {customer.usage_score:.0%} is below the 70% healthy bar.")
    if customer.seat_utilization < 0.5:
        score += 15
        reasons.append("Under half of licensed seats are active.")
    return _clamp(score), reasons


def _proactive_support(customer: CustomerProfile) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = customer.open_support_tickets * 25.0
    reasons.append(f"{customer.open_support_tickets} open support tickets.")
    if customer.nps is not None and customer.nps < 20:
        score += 15
        reasons.append(f"NPS of {customer.nps} signals dissatisfaction.")
    return _clamp(score), reasons


CATALOG: list[Action] = [
    Action(
        action_id="retention_offer",
        title="Offer a retention discount and executive check-in",
        category=ActionCategory.RETENTION,
        is_eligible=lambda c: c.churn_risk >= 0.4 or c.open_support_tickets >= 2,
        score=_retention_offer,
    ),
    Action(
        action_id="upsell_seats",
        title="Propose additional seats",
        category=ActionCategory.EXPANSION,
        is_eligible=lambda c: c.seat_utilization >= 0.75 and c.churn_risk < 0.5,
        score=_upsell_seats,
    ),
    Action(
        action_id="upgrade_tier",
        title="Recommend a plan upgrade",
        category=ActionCategory.EXPANSION,
        is_eligible=lambda c: _TIER_ORDER[c.plan_tier] < _TIER_ORDER[PlanTier.ENTERPRISE]
        and c.usage_score >= 0.5,
        score=_upgrade_tier,
    ),
    Action(
        action_id="onboarding_call",
        title="Schedule an onboarding success call",
        category=ActionCategory.ONBOARDING,
        is_eligible=lambda c: c.tenure_months <= 4 and c.usage_score < 0.6,
        score=_onboarding_call,
    ),
    Action(
        action_id="adoption_nudge",
        title="Send a feature-adoption playbook",
        category=ActionCategory.ADOPTION,
        is_eligible=lambda c: c.usage_score < 0.7,
        score=_adoption_nudge,
    ),
    Action(
        action_id="proactive_support",
        title="Open a proactive support engagement",
        category=ActionCategory.SUPPORT,
        is_eligible=lambda c: c.open_support_tickets >= 1,
        score=_proactive_support,
    ),
]


class NBAEngine:
    """Ranks catalog actions for a given customer profile."""

    def __init__(self, catalog: list[Action] | None = None) -> None:
        self.catalog = catalog if catalog is not None else CATALOG

    def recommend(
        self, customer: CustomerProfile, limit: int = 3
    ) -> list[Recommendation]:
        """Return up to ``limit`` recommendations sorted by descending score."""
        scored: list[Recommendation] = []
        for action in self.catalog:
            if not action.is_eligible(customer):
                continue
            score, reasons = action.score(customer)
            if score <= 0:
                continue
            scored.append(
                Recommendation(
                    action_id=action.action_id,
                    title=action.title,
                    category=action.category,
                    score=round(score, 2),
                    reasons=reasons,
                )
            )
        scored.sort(key=lambda r: r.score, reverse=True)
        return scored[:limit]
