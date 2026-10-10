"""OpenTelemetry -> Cloud Trace (ADK's own spans plus our incident span)."""

from __future__ import annotations

import os

from .logs import log


def setup_tracing(enabled: bool) -> None:
    if not enabled:
        return
    os.environ.setdefault("OTEL_SERVICE_NAME", "agentguard-agent")
    try:
        from google.adk.telemetry.google_cloud import get_gcp_exporters
        from google.adk.telemetry.setup import maybe_set_otel_providers

        maybe_set_otel_providers([get_gcp_exporters(enable_cloud_tracing=True)])
        log("INFO", "Cloud Trace export enabled")
    except Exception as exc:  # tracing must never take the service down
        log("WARNING", "tracing setup failed", error=repr(exc))
