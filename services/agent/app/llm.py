"""Gemini clients: the tenant's own key (BYOK) or the project's demo mode.

BYOK keys live in Firestore only as Cloud KMS ciphertext bound to the tenant
(additional authenticated data = "tenant:<uid>"). Only this service's identity can
decrypt. A key is decrypted right before one incident is processed, used for a client
dedicated to that incident, and never logged, stored, or put into ADK session state.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from functools import lru_cache

from google import genai
from google.cloud import kms

from .config import Settings


class KeyUnavailable(Exception):
    """The tenant chose BYOK but no usable key could be loaded."""


@dataclass
class ModelAccess:
    client: genai.Client
    mode: str  # "byok" | "demo"


@lru_cache(maxsize=1)
def _demo_client(project: str, location: str) -> genai.Client:
    # Gemini Enterprise Agent Platform, authenticated as this service's account (no key).
    return genai.Client(enterprise=True, project=project, location=location)


@lru_cache(maxsize=1)
def _kms_client() -> kms.KeyManagementServiceAsyncClient:
    return kms.KeyManagementServiceAsyncClient()


def tenant_aad(tenant_id: str) -> bytes:
    return f"tenant:{tenant_id}".encode()


async def decrypt_tenant_key(settings: Settings, tenant_id: str, ciphertext_b64: str) -> str:
    resp = await _kms_client().decrypt(
        request={
            "name": settings.kms_key,
            "ciphertext": base64.b64decode(ciphertext_b64),
            "additional_authenticated_data": tenant_aad(tenant_id),
        },
        timeout=10,
    )
    return resp.plaintext.decode("utf-8")


async def model_access(settings: Settings, tenant_id: str, tenant: dict, secret: dict | None) -> ModelAccess:
    if tenant.get("aiMode") == "byok":
        if tenant.get("keyStatus") != "valid" or not secret or not secret.get("ciphertext"):
            raise KeyUnavailable("BYOK is selected but no valid key is registered")
        try:
            api_key = await decrypt_tenant_key(settings, tenant_id, secret["ciphertext"])
        except Exception as exc:
            raise KeyUnavailable(f"could not decrypt the tenant key: {type(exc).__name__}") from None
        return ModelAccess(client=genai.Client(api_key=api_key), mode="byok")
    return ModelAccess(client=_demo_client(settings.project_id, settings.demo_location), mode="demo")
