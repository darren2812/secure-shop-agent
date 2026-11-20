"""GPT-Live voice session (client delegation). The OpenAI key stays on the server.

GPT-Live only talks. When it delegates, the browser sends the transcript to /api/turn and
relays the code-built `say` back with session.commentary.append.
"""
from __future__ import annotations

import logging
import os
import time

log = logging.getLogger("uvicorn.error")

INSTRUCTIONS = """You are Warden, a calm voice for a shopping safety agent. Speak briefly, no exclamations,
no sales language. Never say a store is safe, verified or trusted unless the backend result says so.
Never say "100% safe" or "good deal". You cannot buy anything: when the user wants to buy,
tell them to tap Buy on the screen and confirm.

Delegation policy:
Backend tools:
- Shopping safety: search listings for a product, scan stores, score trust, explain why a store is trusted, in caution or blocked.

Delegate to the backend when:
- The user asks to find, compare or check a product, store or link.
- A correction changes the search already requested.

Do not delegate when:
- The user greets you or asks you to repeat a result already provided.
- You need a brief clarification to understand the request.

Delegate to the backend before giving an answer that depends on backend work.
Do not guess the result while waiting."""

MAX_SESSION_SECONDS = 600
MIN_INTERVAL_SECONDS = 15
_last_session_at = 0.0


class VoiceError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def check_request(origin: str | None, token: str | None) -> None:
    global _last_session_at
    allowed = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    if origin not in allowed:
        raise VoiceError(403, "Unexpected origin")
    expected = os.environ.get("DEMO_TOKEN", "")
    if not expected or token != expected:
        raise VoiceError(401, "Missing or wrong demo token")
    now = time.monotonic()
    if now - _last_session_at < MIN_INTERVAL_SECONDS:
        raise VoiceError(429, "Too many voice sessions, wait a few seconds")
    _last_session_at = now


def create_session(sdp: str) -> dict:
    if not os.environ.get("OPENAI_API_KEY"):
        raise VoiceError(503, "Voice not configured (OPENAI_API_KEY missing); use text input")
    if not sdp.strip() or len(sdp) > 65536:
        raise VoiceError(400, "Invalid SDP offer")
    from openai import APIError, OpenAI

    client = OpenAI(max_retries=0)
    session = {
        "model": os.environ.get("VOICE_MODEL", "gpt-live-1.1"),
        "instructions": INSTRUCTIONS,
        "delegation": {"type": "client"},
        "audio": {"output": {"voice": os.environ.get("VOICE_NAME", "marin")}},
    }
    try:
        result = client.live.create(session=session, transport={"type": "webrtc", "sdp": sdp})
    except APIError as e:
        log.warning("GPT-Live session failed: %s %s", getattr(e, "status_code", None), str(e)[:400])
        raise VoiceError(getattr(e, "status_code", None) or 502, "Voice session creation failed") from e
    return result.model_dump(mode="json")
