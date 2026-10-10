"""OpenTelemetry -> Cloud Trace for our incident span and ADK's own agent/LLM/tool spans.

Exports through the Cloud Trace API (roles/cloudtrace.agent on the service account).
Cloud Run throttles CPU after a response is sent, so spans are flushed before responding.
"""

from __future__ import annotations

from opentelemetry import trace

from .logs import log

_provider = None


def setup_tracing(enabled: bool, project_id: str) -> None:
    global _provider
    if not enabled or _provider is not None:
        return
    try:
        from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": "agentguard-agent"}))
        provider.add_span_processor(BatchSpanProcessor(CloudTraceSpanExporter(project_id=project_id)))
        trace.set_tracer_provider(provider)
        _provider = provider
        log("INFO", "Cloud Trace export enabled")
    except Exception as exc:  # tracing must never take the service down
        log("WARNING", "tracing setup failed", error=repr(exc))


def flush_traces(timeout_ms: int = 5000) -> None:
    if _provider is not None:
        try:
            _provider.force_flush(timeout_millis=timeout_ms)
        except Exception as exc:
            log("WARNING", "trace flush failed", error=repr(exc))


def trace_url(project_id: str, trace_id: str | None) -> str | None:
    if not trace_id:
        return None
    return f"https://console.cloud.google.com/traces/explorer;traceId={trace_id}?project={project_id}"
