"""Data contracts: the WAF event we receive and the analyst's verdict."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AttackType = Literal[
    "sqli", "xss", "path_traversal", "cmd_injection", "prompt_injection", "recon", "benign", "other"
]
Severity = Literal["low", "medium", "high", "critical"]
SEVERITY_ORDER: dict[str, int] = {"low": 0, "medium": 1, "high": 2, "critical": 3}


class SecurityEvent(BaseModel):
    """Published by the target service (Mihari) for every blocked request."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    version: int = 1
    event_id: str = Field(alias="eventId", pattern=r"^[a-f0-9]{32}$")
    tenant_id: str = Field(alias="tenantId", min_length=1, max_length=128)
    site_id: str = Field(alias="siteId", max_length=64)
    received_at: datetime = Field(alias="receivedAt")
    waf_rule_ms: float = Field(alias="wafRuleMs", ge=0)
    rule_id: str = Field(alias="ruleId", max_length=64)
    attack_type: str = Field(alias="attackType", max_length=32)
    rule_label_ja: str = Field(alias="ruleLabelJa", max_length=200)
    field: str = Field(max_length=200)
    matched: str = Field(max_length=4096)
    payload: str = Field(max_length=4096)
    src_ip: str = Field(alias="srcIp", max_length=64)
    simulated: bool = False
    method: str = Field(max_length=16)
    path: str = Field(max_length=2048)
    user_agent: str = Field(default="", alias="userAgent", max_length=512)


class Verdict(BaseModel):
    """Structured output of Shirabe (the analyst)."""

    attack_type: AttackType
    confidence: float = Field(ge=0.0, le=1.0, description="How sure you are that the request is malicious (0.0-1.0).")
    severity: Severity
    targets_ai: bool = Field(description="True if the payload tries to give orders to an AI (prompt injection).")
    recommended_action: Literal["block", "watch", "isolate", "none"]
    narration_ja: str = Field(description="1-2 short Japanese sentences (max 120 chars) explaining the judgement live.")
    evidence: list[str] = Field(description="Up to 3 short phrases describing what you saw. No raw payload.")
