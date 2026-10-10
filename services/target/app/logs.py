"""Structured JSON logs that Cloud Logging understands. Never pass secrets here."""

from __future__ import annotations

import json
import sys
from typing import Any


def log(severity: str, message: str, **fields: Any) -> None:
    entry = {"severity": severity, "message": message, "component": "target", **fields}
    print(json.dumps(entry, ensure_ascii=False, default=str), file=sys.stdout, flush=True)
