"""Runtime configuration (environment variables)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import google.auth


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    project_id: str
    region: str
    model: str
    demo_location: str
    kms_key: str
    armor_location: str
    armor_input_template: str
    armor_output_template: str
    demo_daily_limit_per_tenant: int
    demo_daily_limit_global: int
    byok_daily_limit_per_tenant: int
    dedupe_window_sec: int
    max_block_minutes: int
    fallback_block_minutes: int
    run_timeout_sec: int
    price_input_per_mtok: float
    price_output_per_mtok: float
    enable_cloud_trace: bool
    dev_mode: bool


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
        model=os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
        demo_location=os.environ.get("GEMINI_LOCATION", "global"),
        kms_key=os.environ.get(
            "KMS_KEY", f"projects/{project}/locations/{region}/keyRings/byok/cryptoKeys/tenant-gemini-key"
        ),
        armor_location=armor_location,
        armor_input_template=os.environ.get("ARMOR_INPUT_TEMPLATE", f"{armor_base}/agentguard-input"),
        armor_output_template=os.environ.get("ARMOR_OUTPUT_TEMPLATE", f"{armor_base}/agentguard-output"),
        demo_daily_limit_per_tenant=_int("DEMO_DAILY_LIMIT_PER_TENANT", 10),
        demo_daily_limit_global=_int("DEMO_DAILY_LIMIT_GLOBAL", 100),
        byok_daily_limit_per_tenant=_int("BYOK_DAILY_LIMIT_PER_TENANT", 200),
        dedupe_window_sec=_int("DEDUPE_WINDOW_SEC", 300),
        max_block_minutes=_int("MAX_BLOCK_MINUTES", 1440),
        fallback_block_minutes=_int("FALLBACK_BLOCK_MINUTES", 30),
        run_timeout_sec=_int("RUN_TIMEOUT_SEC", 90),
        # gemini-3.8-flash list price (USD per 1M tokens); thoughts are billed as output.
        price_input_per_mtok=float(os.environ.get("PRICE_INPUT_PER_MTOK", "0.75")),
        price_output_per_mtok=float(os.environ.get("PRICE_OUTPUT_PER_MTOK", "3.75")),
        enable_cloud_trace=os.environ.get("ENABLE_CLOUD_TRACE", "false").lower() == "true",
        dev_mode=os.environ.get("DEV_MODE", "false").lower() == "true",
    )
