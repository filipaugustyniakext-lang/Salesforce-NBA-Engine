"""Domain models for the Next Best Action engine.

These Pydantic models define the public contract of the engine: the shape of a
customer profile that is scored, the actions that live in the catalog, and the
ranked recommendations that come back out.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class PlanTier(str, Enum):
    """Subscription tier of a customer account."""

    FREE = "free"
    STARTER = "starter"
    PROFESSIONAL = "professional"
    ENTERPRISE = "enterprise"


class ActionCategory(str, Enum):
    """High-level grouping used to balance recommendations across intents."""

    RETENTION = "retention"
    EXPANSION = "expansion"
    ONBOARDING = "onboarding"
    SUPPORT = "support"
    ADOPTION = "adoption"


class CustomerProfile(BaseModel):
    """A snapshot of a single account used as engine input.

    Attributes are intentionally simple, numeric or categorical signals that a
    CRM (e.g. Salesforce) would already track on an account record.
    """

    customer_id: str = Field(..., description="Stable identifier for the account.")
    name: str = Field(..., description="Human-readable account name.")
    plan_tier: PlanTier = Field(..., description="Current subscription tier.")
    tenure_months: int = Field(..., ge=0, description="Months as a paying customer.")
    monthly_spend: float = Field(..., ge=0, description="Current monthly recurring revenue.")
    seats_used: int = Field(..., ge=0, description="Active seats currently in use.")
    seats_licensed: int = Field(..., ge=0, description="Seats the account has paid for.")
    usage_score: float = Field(
        ..., ge=0, le=1, description="Normalized product engagement (0-1)."
    )
    churn_risk: float = Field(
        ..., ge=0, le=1, description="Predicted probability of churn (0-1)."
    )
    open_support_tickets: int = Field(
        ..., ge=0, description="Number of currently open support tickets."
    )
    nps: Optional[int] = Field(
        None, ge=-100, le=100, description="Most recent Net Promoter Score, if known."
    )

    @property
    def seat_utilization(self) -> float:
        """Fraction of licensed seats actually in use (0-1)."""
        if self.seats_licensed <= 0:
            return 0.0
        return min(self.seats_used / self.seats_licensed, 1.0)


class Recommendation(BaseModel):
    """A single scored action returned to the caller."""

    action_id: str
    title: str
    category: ActionCategory
    score: float = Field(..., description="Priority score; higher is more urgent/valuable.")
    reasons: list[str] = Field(
        default_factory=list, description="Human-readable justifications for the score."
    )


class RecommendationResponse(BaseModel):
    """Envelope returned by the recommend endpoint."""

    customer_id: str
    generated_count: int
    recommendations: list[Recommendation]
