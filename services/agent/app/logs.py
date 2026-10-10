"""Structured JSON logs that Cloud Logging understands. Never pass secrets here."""

from __future__ import annotations

import json
import re
import sys
from typing import Any

# Defense in depth: mask anything that looks like a Google API key before it is printed.
_API_KEY_RE = re.compile(r"AIza[0-9A-Za-z_\-]{20,}")


def redact(text: str) -> str:
    return _API_KEY_RE.sub("AIza…[redacted]", text)


def log(severity: str, message: str, **fields: Any) -> None:
    entry = {"severity": severity, "message": message, "component": "agent", **fields}
    print(redact(json.dumps(entry, ensure_ascii=False, default=str)), file=sys.stdout, flush=True)
