"""IP helpers and the dashboard's service-account token check.

The attack simulator in the dashboard reports synthetic events from *documentation* addresses
(RFC 5737) so no real person can ever be blocked by a demo. Such reports, and AgentGuard's own
traffic, are trusted only with a Google-signed ID token of the dashboard's service account.
"""

from __future__ import annotations

import hashlib
import ipaddress
import threading
import time

import google.auth.transport.requests
import requests
from google.oauth2 import id_token


DOCUMENTATION_NETS = tuple(
    ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")
)


def parse_ip(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def is_documentation_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return any(addr in net for net in DOCUMENTATION_NETS)




class SimTokenVerifier:
    """Verifies the dashboard's ID token once, then trusts it until it expires."""

    def __init__(self, allowed_email: str):
        self._allowed_email = allowed_email
        self._verified: dict[str, float] = {}
        self._lock = threading.Lock()
        self._request = google.auth.transport.requests.Request(session=requests.Session())

    def verify(self, token: str, audience: str) -> bool:
        key = hashlib.sha256(f"{audience}|{token}".encode()).hexdigest()
        now = time.time()
        with self._lock:
            exp = self._verified.get(key)
            if exp and exp > now + 30:
                return True
        try:
            claims = id_token.verify_oauth2_token(token, self._request, audience=audience)
        except ValueError:
            return False
        if claims.get("email") != self._allowed_email or not claims.get("email_verified"):
            return False
        with self._lock:
            if len(self._verified) > 1000:
                self._verified = {k: v for k, v in self._verified.items() if v > now}
            self._verified[key] = float(claims["exp"])
        return True
