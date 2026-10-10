"""Per-incident state shared by the workflow nodes and the defender's tools."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import Settings
from .guard import GuardResult
from .models import SecurityEvent, Verdict
from .store import Store


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0  # includes thinking tokens (billed as output)

    def add(self, meta) -> None:
        if meta is None:
            return
        self.input_tokens += meta.prompt_token_count or 0
        self.output_tokens += (meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0)

    def cost_usd(self, settings: Settings) -> float:
        return round(
            self.input_tokens / 1e6 * settings.price_input_per_mtok
            + self.output_tokens / 1e6 * settings.price_output_per_mtok,
            6,
        )


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
