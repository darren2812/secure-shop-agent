"""HTTP API. Identity comes from the server (demo: one seeded user), never from the body or the LLM."""
from __future__ import annotations

import hashlib
import hmac
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from . import attacks, audit, db, extras, persona, voice  # noqa: E402
from .agent import run_turn  # noqa: E402
from .chat import chat_reply, chat_status  # noqa: E402
from .policy import PolicyError, check_policy, get_profile, place_order, set_limits, verify_identity  # noqa: E402
from .seed import reset_and_seed  # noqa: E402

@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    with db.connect() as conn:
        if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            reset_and_seed()
    await extras.startup()
    yield


app = FastAPI(title="Secure Shopping Agent", lifespan=lifespan)
def allowed_origins() -> list[str]:
    return [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Demo-Token"],
)

DEMO_USER = "u_demo"


def current_user() -> str:
    return DEMO_USER  # hackathon: single demo account; production = real session


LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


def demo_only(request: Request, x_demo_token: str | None = Header(default=None)) -> None:
    """Demo/admin routes: this machine or the demo token. Never another site, the LAN or a tunnel."""
    origin = request.headers.get("origin")
    if origin and origin not in allowed_origins():  # bodyless POSTs skip the CORS preflight
        raise HTTPException(403, "Unexpected origin")
    hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    peer = request.client.host if request.client else ""
    local = peer in LOOPBACK and all(h in LOOPBACK for h in hops)  # Vite proxy sets X-Forwarded-For (xfwd)
    expected = os.environ.get("DEMO_TOKEN", "")
    has_token = bool(expected) and hmac.compare_digest((x_demo_token or "").encode(), expected.encode())
    if not (local or has_token):
        raise HTTPException(403, "Demo endpoint not available from this network")


# Request ids are opaque labels for an audit chain ("req_…" from us, "fd_1" from Firedrill), never paths or markup.
RID = r"^[A-Za-z0-9_-]{1,64}$"


class TurnIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    request_id: str | None = Field(default=None, pattern=RID)


class PolicyIn(BaseModel):
    listing_id: str = Field(max_length=64)
    request_id: str = Field(pattern=RID)


class OrderIn(BaseModel):
    decision_id: str = Field(max_length=64)
    verification_id: str | None = Field(default=None, max_length=128)


class ReportIn(BaseModel):
    store_id: str = Field(max_length=64)
    request_id: str | None = Field(default=None, pattern=RID)


class SdpIn(BaseModel):
    sdp: str = Field(min_length=1, max_length=65536)


@app.get("/api/health")
def health():
    return {"ok": True, "voice": bool(os.environ.get("OPENAI_API_KEY")), "llm": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "persona": persona.enabled(), "extras": extras.statuses()}


@app.get("/health")
def health_root():
    return {"ok": True}


class VerifyIn(BaseModel):
    inquiry_id: str = Field(min_length=1, max_length=128)


class LimitsIn(BaseModel):
    # Ranges are checked in set_limits so every bad value comes back as a plain 400 {code, message}.
    per_purchase_limit: float
    monthly_cap: float
    allow_marketplace: bool


@app.get("/api/me")
def me():
    return get_profile(current_user())


@app.post("/api/me/verify", dependencies=[Depends(demo_only)])
def me_verify(body: VerifyIn):
    """One-time Persona verification at signup."""
    try:
        return verify_identity(current_user(), body.inquiry_id)
    except PolicyError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message, "charged": False})


@app.put("/api/me/limits", dependencies=[Depends(demo_only)])
def me_limits(body: LimitsIn):
    """Spending limits, set by the person in the UI. Deliberately not an agent tool."""
    try:
        return set_limits(current_user(), body.per_purchase_limit, body.monthly_cap, body.allow_marketplace)
    except PolicyError as e:
        raise HTTPException(400, {"code": e.code, "message": e.message})


@app.get("/api/trust")
def trust():
    """What data goes where, and which protections are active. Shown in the Security & receipts panel."""
    return {
        "identity": {"verified": get_profile(current_user())["verified"]},
        "data_flows": [
            {"service": "Claude (Anthropic)", "purpose": "Chooses which stores to scan and explains results",
             "data_sent": "Your product request, store signals, seller text marked as untrusted",
             "data_not_sent": "Your identity, card, limits, purchase decisions"},
            {"service": "GPT-Live (OpenAI)", "purpose": "Voice conversation",
             "data_sent": "Your voice, and the verdict sentence our code writes (store names cleaned to a plain name)",
             "data_not_sent": "Listing titles, seller policies, your identity, card, limits"},
            {"service": "Persona", "purpose": "Verify your identity once (ID + selfie)",
             "data_sent": "Your ID photo and selfie, sent directly to Persona",
             "data_not_sent": "Your shopping requests and purchases"},
            {"service": "SingleStore", "purpose": "Store data, fraud-ring query, hash-chained receipts",
             "data_sent": "Stores, listings, decisions, purchases, audit events",
             "data_not_sent": "Card numbers (checkout is simulated)"},
            {"service": "Firedrill", "purpose": "Attack drills against the agent",
             "data_sent": "Test requests to our agent endpoint only",
             "data_not_sent": "Real user data"},
        ],
        "controls": [
            {"name": "Code decides, AI explains", "how": "Scores, tiers, limits and orders are plain code; the AI has no purchase tool"},
            {"name": "Spotlighted seller text", "how": "Seller text is wrapped in a random per-request marker and datamarked, so the AI treats it as data"},
            {"name": "AI can't raise your limit", "how": "Only you can change your limits, in the app"},
            {"name": "Card data never stored", "how": "Payments are tokenized by the processor; Warden never sees or stores card numbers (PCI DSS SAQ A model)"},
            {"name": "Voice can't buy", "how": "Only a tap on Buy + Confirm can place an order"},
            {"name": "Identity verified once", "how": "Persona ID + selfie; the server checks the result, never the browser"},
            {"name": "Single-use decisions", "how": "Each purchase decision can be used once, even with parallel requests"},
            {"name": "Tamper-evident receipts", "how": "Each event is chained to the previous one" + (" with a server-only HMAC key" if os.environ.get("AUDIT_HMAC_KEY") else "")},
            {"name": "Demo controls stay local", "how": "Reset, attacks, reports and verification only answer this machine or the demo app"},
            {"name": "Protected voice endpoint", "how": "Origin allowlist, demo token, rate limit; API keys never reach the browser"},
            {"name": "Encryption in transit", "how": "HTTPS/TLS when deployed; keys stay server-side"},
        ],
    }


@app.post("/api/turn")
def turn(body: TurnIn):
    """Text, pasted link or voice transcript. Never buys anything."""
    return run_turn(body.text, body.request_id)


class ChatIn(BaseModel):
    """Firedrill http.v1 `message-text` shape. The session key becomes the request_id (audit chain)."""
    message: str = Field(min_length=1, max_length=2000)
    session: str | None = None


POLICY_CMD = "/policy-check "


@app.post("/chat")
def chat(body: ChatIn, request: Request, x_demo_token: str | None = Header(default=None)):
    """Chat-shaped alias of /api/turn for Firedrill drills. Never buys anything.

    `/policy-check <listing_id>` (this machine or demo token only) runs the same turn, then the policy check,
    so a drill can see the purchase decision. It never calls place_order.
    """
    session = body.session
    if session is not None and not re.fullmatch(RID, session):
        session = "fd_" + hashlib.sha256(session.encode()).hexdigest()[:16]
    decision = None
    if body.message.startswith(POLICY_CMD):
        demo_only(request, x_demo_token)
        listing_id = body.message[len(POLICY_CMD):].strip()[:64]
        out = run_turn(f"I want to buy listing {listing_id}", session)
        try:
            decision = check_policy(current_user(), listing_id, out["request_id"])
        except PolicyError as e:
            raise HTTPException(400, {"code": e.code, "message": e.message, "charged": False})
        reply = (f"Policy check for {listing_id} ({decision['store']['name']}, ${decision['amount']:.0f}, tier {decision['tier']}): "
                 f"outcome={decision['outcome']}. Reasons: {'; '.join(decision['reasons'])}. "
                 f"Warnings: {'; '.join(decision['warnings']) or 'none'}. No order was placed.")
    else:
        out = run_turn(body.message, session)
    out["status"] = chat_status(out)
    out["reply"] = chat_reply(out)
    out["session"] = out["request_id"]
    if decision is not None:
        out.update(policy=decision, order_placed=False)
        out["reply"] = reply + "\n" + out["reply"]
    return out


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


@app.post("/api/persona/stub-pass/{inquiry_id}", dependencies=[Depends(demo_only)])
def persona_stub(inquiry_id: str):
    """Local demo only, disabled when PERSONA_API_KEY is set."""
    if persona.enabled():
        raise HTTPException(404)
    if len(inquiry_id) > 128:
        raise HTTPException(422, "inquiry_id too long")
    persona.stub_mark_passed(inquiry_id)
    return {"inquiry_id": inquiry_id, "status": "completed", "stub": True}


@app.get("/api/audit/{request_id}")
def audit_trail(request_id: str):
    return {"request_id": request_id, "events": audit.get_trail(request_id)}


@app.post("/api/audit/{request_id}/verify")
def audit_verify(request_id: str):
    return audit.verify_trail(request_id)


@app.post("/api/reports", dependencies=[Depends(demo_only)])
def report(body: ReportIn):
    with db.connect() as conn:
        cur = conn.execute("UPDATE stores SET flagged = 1 WHERE id = ?", (body.store_id,))
        if cur.rowcount != 1:
            raise HTTPException(404, "store not found")
    if body.request_id:
        audit.write_audit_event(body.request_id, "store_reported", "user", {"store_id": body.store_id})
    return {"store_id": body.store_id, "flagged": True}


@app.post("/api/reset_demo", dependencies=[Depends(demo_only)])
def reset_demo():
    reset_and_seed()
    extras.reset()
    return {"reset": True}


@app.get("/api/attacks")
def attack_list():
    return [{"name": k, "description": v} for k, v in attacks.SCENARIOS.items()]


@app.post("/api/attacks/{name}", dependencies=[Depends(demo_only)])
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
