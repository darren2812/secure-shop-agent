"""HTTP API. Identity comes from the server (demo: one seeded user), never from the body or the LLM."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from . import attacks, audit, db, persona, voice  # noqa: E402
from .agent import run_turn  # noqa: E402
from .policy import PolicyError, check_policy, place_order  # noqa: E402
from .seed import reset_and_seed  # noqa: E402

@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    with db.connect() as conn:
        if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            reset_and_seed()
    yield


app = FastAPI(title="Secure Shopping Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Demo-Token"],
)

DEMO_USER = "u_demo"


def current_user() -> str:
    return DEMO_USER  # hackathon: single demo account; production = real session


class TurnIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    request_id: str | None = Field(default=None, max_length=64)


class PolicyIn(BaseModel):
    listing_id: str = Field(max_length=64)
    request_id: str = Field(max_length=64)


class OrderIn(BaseModel):
    decision_id: str = Field(max_length=64)
    verification_id: str | None = Field(default=None, max_length=128)


class ReportIn(BaseModel):
    store_id: str = Field(max_length=64)
    request_id: str | None = Field(default=None, max_length=64)


class SdpIn(BaseModel):
    sdp: str = Field(min_length=1, max_length=65536)


@app.get("/api/health")
def health():
    return {"ok": True, "voice": bool(os.environ.get("OPENAI_API_KEY")), "llm": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "persona": persona.enabled()}


@app.post("/api/turn")
def turn(body: TurnIn):
    """Text, pasted link or voice transcript. Never buys anything."""
    return run_turn(body.text, body.request_id)


@app.post("/api/policy/check")
def policy_check(body: PolicyIn):
    try:
        return check_policy(current_user(), body.listing_id, body.request_id)
    except PolicyError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message, "charged": False})


@app.post("/api/orders")
def orders(body: OrderIn):
    """Called only by the Buy/Confirm button after check_policy."""
    try:
        return place_order(current_user(), body.decision_id, body.verification_id)
    except PolicyError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message, "charged": e.charged})


@app.post("/api/persona/stub-pass/{inquiry_id}")
def persona_stub(inquiry_id: str):
    """Local demo only, disabled when PERSONA_API_KEY is set."""
    if persona.enabled():
        raise HTTPException(404)
    persona.stub_mark_passed(inquiry_id)
    return {"inquiry_id": inquiry_id, "status": "completed", "stub": True}


@app.get("/api/audit/{request_id}")
def audit_trail(request_id: str):
    return {"request_id": request_id, "events": audit.get_trail(request_id)}


@app.post("/api/audit/{request_id}/verify")
def audit_verify(request_id: str):
    return audit.verify_trail(request_id)


@app.post("/api/reports")
def report(body: ReportIn):
    with db.connect() as conn:
        cur = conn.execute("UPDATE stores SET flagged = 1 WHERE id = ?", (body.store_id,))
        if cur.rowcount != 1:
            raise HTTPException(404, "store not found")
    if body.request_id:
        audit.write_audit_event(body.request_id, "store_reported", "user", {"store_id": body.store_id})
    return {"store_id": body.store_id, "flagged": True}


@app.post("/api/reset_demo")
def reset_demo():
    reset_and_seed()
    return {"reset": True}


@app.get("/api/attacks")
def attack_list():
    return [{"name": k, "description": v} for k, v in attacks.SCENARIOS.items()]


@app.post("/api/attacks/{name}")
def attack_run(name: str):
    """Demo only: mutate seeded data the way an attacker would, then re-scan with the same code."""
    from .tools import listing_by_id, scan_store

    if name not in attacks.SCENARIOS:
        raise HTTPException(404, "unknown scenario")
    before = None
    preview = {"prompt_injection": "l_apple_outlet", "fake_discount": "l_amz"}.get(name)
    if preview:
        l = listing_by_id(preview)
        before = scan_store(l["store_id"], l)
    target = attacks.run(name)
    l = listing_by_id(target["listing_id"])
    after = scan_store(l["store_id"], l)
    request_id = f"attack_{name}"
    audit.write_audit_event(request_id, "attack_scenario", "system", {
        "scenario": name, "listing_id": l["id"], "tier_before": before and before["tier"],
        "tier_after": after["tier"], "score_after": after["score"], "reasons": [r["code"] for r in after["reasons"]],
    })
    return {"scenario": name, "description": attacks.SCENARIOS[name], "request_id": request_id,
            "listing": {"id": l["id"], "title": l["title"], "price": float(l["price"])},
            "before": before and {"tier": before["tier"], "score": before["score"]},
            "after": after}


@app.post("/api/voice/session")
def voice_session(body: SdpIn, request: Request, x_demo_token: str | None = Header(default=None)):
    try:
        voice.check_request(request.headers.get("origin"), x_demo_token)
        return voice.create_session(body.sdp)
    except voice.VoiceError as e:
        raise HTTPException(e.status, e.message)
