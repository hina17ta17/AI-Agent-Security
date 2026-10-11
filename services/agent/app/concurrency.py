"""Rules for many attacks at once (pure functions, unit-tested).

- A tenant runs at most MAX_CONCURRENT_AI full AI investigations at the same time.
- The tenant is "responding" while any investigation is active; entries older than
  STALE_AFTER_SEC are ignored, so a crashed run can never keep the dashboard red.
- Beyond the cap, events join an "attack wave": they are blocked at once by rule (no AI call).
  The block length is the wave policy for that attack type, raised to the AI's decision when
  an investigation of the same type in the wave chose longer; when the AI decides later,
  shorter rule blocks are extended. Defenses only ever get stricter: a single AI judgment
  never makes the rest of a mass attack go free sooner than the policy.
"""

from __future__ import annotations

from datetime import datetime

STALE_AFTER_SEC = 300
WAVE_IDLE_SEC = 60

DEFAULT_WAVE_MINUTES = {
    "sqli": 120,
    "cmd_injection": 720,
    "xss": 60,
    "path_traversal": 60,
}
FALLBACK_WAVE_MINUTES = 60


def prune_active(active: dict | None, now: datetime, stale_sec: int = STALE_AFTER_SEC) -> dict[str, datetime]:
    """Keep only active investigations that started less than stale_sec ago."""
    kept: dict[str, datetime] = {}
    for incident_id, started in (active or {}).items():
        if isinstance(started, datetime) and (now - started).total_seconds() < stale_sec:
            kept[incident_id] = started
    return kept


def derive_status(active_count: int, pending_approval: bool) -> str:
    if active_count > 0:
        return "responding"
    return "awaiting_approval" if pending_approval else "safe"


def wave_block_minutes(attack_type: str, ai_decisions: dict | None) -> tuple[int, str]:
    """Block length for a wave event, and where it came from ("ai" or "policy")."""
    policy = DEFAULT_WAVE_MINUTES.get(attack_type, FALLBACK_WAVE_MINUTES)
    decided = ((ai_decisions or {}).get(attack_type) or {}).get("minutes")
    if isinstance(decided, int) and not isinstance(decided, bool) and decided > policy:
        return decided, "ai"
    return policy, "policy"


def is_open(last_event_at: datetime | None, now: datetime, idle_sec: int = WAVE_IDLE_SEC) -> bool:
    return isinstance(last_event_at, datetime) and (now - last_event_at).total_seconds() < idle_sec
