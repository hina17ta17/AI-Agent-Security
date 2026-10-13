"""Runtime configuration (environment variables)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import google.auth


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


# USD per 1M tokens (input, output). Thinking tokens are billed as output.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.5-flash-lite": (0.30, 2.50),
}
DEFAULT_PRICE = (0.75, 3.75)


@dataclass(frozen=True)
class Settings:
    project_id: str
    region: str
    model_analyst: str  # fast, bounded classification
    model_defender: str  # tool use; safety rules are enforced in code, so speed wins
    model_reporter: str  # writing quality (runs after the defense, so latency matters less)
    demo_location: str
    kms_key: str
    armor_location: str
    armor_input_template: str
    armor_output_template: str
    demo_daily_limit_per_tenant: int  # demo runs per account per day
    demo_total_limit_per_tenant: int  # demo runs per account ever (lifetime cap)
    demo_daily_limit_global: int
    byok_daily_limit_per_tenant: int  # default cap for a new BYOK account (the owner can change it)
    self_tenant_id: str  # the account that receives AgentGuard's own incidents ("" if not set up)
    self_daily_limit: int  # AI runs per day for AgentGuard's own protection (its own budget)
    dedupe_window_sec: int
    max_block_minutes: int
    fallback_block_minutes: int
    run_timeout_sec: int
    max_run_events: int  # hard cap on AI events per incident, so a runaway loop stops early
    max_concurrent_ai: int  # full AI investigations per tenant at the same time
    active_stale_sec: int
    wave_idle_sec: int
    enable_cloud_trace: bool
    dev_mode: bool

    @property
    def models(self) -> set[str]:
        return {self.model_analyst, self.model_defender, self.model_reporter}


@lru_cache
def get_settings() -> Settings:
    project = os.environ.get("PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        _, project = google.auth.default()
    if not project:
        raise RuntimeError("PROJECT_ID is not set and could not be inferred")
    region = os.environ.get("REGION", "asia-northeast1")
    armor_location = os.environ.get("ARMOR_LOCATION", "us")
    armor_base = f"projects/{project}/locations/{armor_location}/templates"
    return Settings(
        project_id=project,
        region=region,
        model_analyst=os.environ.get("MODEL_ANALYST", "gemini-3.5-flash-lite"),
        # Benchmarked 2026-10-11: flash-lite made the same policy-compliant decisions ~3x faster.
        model_defender=os.environ.get("MODEL_DEFENDER", "gemini-3.5-flash-lite"),
        model_reporter=os.environ.get("MODEL_REPORTER", "gemini-3.8-flash"),
        demo_location=os.environ.get("GEMINI_LOCATION", "global"),
        kms_key=os.environ.get(
            "KMS_KEY", f"projects/{project}/locations/{region}/keyRings/byok/cryptoKeys/tenant-gemini-key"
        ),
        armor_location=armor_location,
        armor_input_template=os.environ.get("ARMOR_INPUT_TEMPLATE", f"{armor_base}/agentguard-input"),
        armor_output_template=os.environ.get("ARMOR_OUTPUT_TEMPLATE", f"{armor_base}/agentguard-output"),
        demo_daily_limit_per_tenant=_int("DEMO_DAILY_LIMIT_PER_TENANT", 3),
        demo_total_limit_per_tenant=_int("DEMO_TOTAL_LIMIT_PER_TENANT", 10),
        demo_daily_limit_global=_int("DEMO_DAILY_LIMIT_GLOBAL", 100),
        byok_daily_limit_per_tenant=_int("BYOK_DAILY_LIMIT_PER_TENANT", 200),
        self_tenant_id=os.environ.get("SELF_TENANT_ID", ""),
        self_daily_limit=_int("SELF_DAILY_LIMIT", 100),
        dedupe_window_sec=_int("DEDUPE_WINDOW_SEC", 300),
        max_block_minutes=_int("MAX_BLOCK_MINUTES", 1440),
        fallback_block_minutes=_int("FALLBACK_BLOCK_MINUTES", 30),
        run_timeout_sec=_int("RUN_TIMEOUT_SEC", 90),
        max_run_events=_int("MAX_RUN_EVENTS", 50),
        max_concurrent_ai=_int("MAX_CONCURRENT_AI_PER_TENANT", 3),
        active_stale_sec=_int("ACTIVE_STALE_SEC", 300),
        wave_idle_sec=_int("WAVE_IDLE_SEC", 60),
        enable_cloud_trace=os.environ.get("ENABLE_CLOUD_TRACE", "false").lower() == "true",
        dev_mode=os.environ.get("DEV_MODE", "false").lower() == "true",
    )
