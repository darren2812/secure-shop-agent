"""Persona step-up. Darren wires the real sandbox; until then a local stub.

Rule: the server asks Persona whether an inquiry passed. Never trust a status sent by the browser.
"""
from __future__ import annotations

import os

import httpx

PERSONA_API = "https://withpersona.com/api/v1"
_stub_passed: set[str] = set()


def enabled() -> bool:
    return bool(os.environ.get("PERSONA_API_KEY"))


def stub_mark_passed(inquiry_id: str) -> None:
    """Local demo only (no PERSONA_API_KEY): simulate a completed sandbox inquiry."""
    if enabled():
        raise RuntimeError("stub disabled when Persona is configured")
    _stub_passed.add(inquiry_id)


def is_passed(inquiry_id: str) -> bool:
    if not enabled():
        return inquiry_id in _stub_passed
    try:
        r = httpx.get(
            f"{PERSONA_API}/inquiries/{inquiry_id}",
            headers={"Authorization": f"Bearer {os.environ['PERSONA_API_KEY']}", "Persona-Version": "2023-01-05"},
            timeout=10,
        )
        r.raise_for_status()
        status = r.json()["data"]["attributes"]["status"]
    except (httpx.HTTPError, KeyError, ValueError):
        return False
    return status in {"completed", "approved"}
