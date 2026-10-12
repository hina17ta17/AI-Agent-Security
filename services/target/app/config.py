"""Runtime configuration (environment variables)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import google.auth


@dataclass(frozen=True)
class Settings:
    project_id: str
    events_topic: str
    dashboard_sa: str  # only this identity may attach a simulated source IP
    sim_audience: str | None  # expected ID-token audience; defaults to https://<Host>
    # Size of one report. Fields inside are cut to 64 KiB each before inspection (never refused).
    max_body_bytes: int = 256 * 1024
    # The tenant that receives AgentGuard's own traffic (the dashboard protects itself). Fixed here,
    # never taken from a request; empty disables self-protection.
    self_tenant_id: str = ""


@lru_cache
def get_settings() -> Settings:
    project = os.environ.get("PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        _, project = google.auth.default()
    if not project:
        raise RuntimeError("PROJECT_ID is not set and could not be inferred")
    return Settings(
        project_id=project,
        events_topic=os.environ.get("EVENTS_TOPIC", "security-events"),
        dashboard_sa=os.environ.get("DASHBOARD_SA", f"sa-dashboard@{project}.iam.gserviceaccount.com"),
        sim_audience=os.environ.get("SIM_AUDIENCE") or None,
        self_tenant_id=os.environ.get("SELF_TENANT_ID", ""),
    )
