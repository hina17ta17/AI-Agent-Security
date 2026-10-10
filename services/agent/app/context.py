"""Per-incident state shared by the workflow nodes and the defender's tools."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import DEFAULT_PRICE, MODEL_PRICES, Settings
from .guard import GuardResult
from .models import SecurityEvent, Verdict
from .store import Store


def price_for(model: str | None) -> tuple[float, float]:
    for name, price in MODEL_PRICES.items():
        if model and model.startswith(name):
            return price
    return DEFAULT_PRICE


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0  # includes thinking tokens (billed as output)
    cost: float = 0.0
    by_model: dict = field(default_factory=dict)

    def add(self, meta, model: str | None) -> None:
        if meta is None:
            return
        tokens_in = meta.prompt_token_count or 0
        tokens_out = (meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0)
        self.input_tokens += tokens_in
        self.output_tokens += tokens_out
        price_in, price_out = price_for(model)
        self.cost += tokens_in / 1e6 * price_in + tokens_out / 1e6 * price_out
        key = model or "unknown"
        entry = self.by_model.setdefault(key, {"inputTokens": 0, "outputTokens": 0})
        entry["inputTokens"] += tokens_in
        entry["outputTokens"] += tokens_out

    def cost_usd(self) -> float:
        return round(self.cost, 6)


@dataclass
class Incident:
    settings: Settings
    store: Store
    event: SecurityEvent
    incident_id: str
    allowlist: list[str]
    previous_incidents: int = 0
    mode: str = "demo"
    guard: GuardResult | None = None
    verdict: Verdict | None = None
    route: str | None = None
    actions: list[dict] = field(default_factory=list)
    approvals: list[dict] = field(default_factory=list)
    timings: dict = field(default_factory=dict)
    usage: Usage = field(default_factory=Usage)
    tool_calls: int = 0
    seq: int = 0

    @property
    def tenant_id(self) -> str:
        return self.event.tenant_id

    def mark(self, name: str) -> datetime:
        now = datetime.now(timezone.utc)
        self.timings.setdefault(name, now)
        return now

    async def step(self, agent: str, kind: str, text: str, extra: dict | None = None) -> None:
        self.seq += 1
        await self.store.add_step(self.tenant_id, self.incident_id, self.seq, agent, kind, text, extra)
