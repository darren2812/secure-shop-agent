"""check_policy and place_order. Plain code, called only from the Buy button route.

The LLM has no access to these functions. Identity comes from the server session.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from . import db, persona
from .audit import get_trail, write_audit_event
from .tools import listing_by_id, scan_store

DECISION_TTL = timedelta(minutes=5)


class PolicyError(Exception):
    def __init__(self, code: str, message: str, charged: bool = False):
        super().__init__(message)
        self.code, self.message, self.charged = code, message, charged


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _user(conn, user_id: str) -> dict:
    row = conn.execute(
        "SELECT per_purchase_limit, monthly_cap, allow_marketplace, verified FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not row:
        raise PolicyError("unknown_user", "Unknown user")
    return {"limit": float(row[0]), "cap": float(row[1]), "allow_marketplace": bool(row[2]), "verified": bool(row[3])}


def check_policy(user_id: str, listing_id: str, request_id: str) -> dict:
    """Authoritative re-check at pick time. Returns allow | verify | deny with reasons and a single-use decision_id."""
    # Every purchase receipt starts with what the user asked for; never write into chains that didn't.
    if not any(e.get("step") == "user_request" for e in get_trail(request_id)):
        raise PolicyError("unknown_request", "Not charged: start from a search first")
    listing = listing_by_id(listing_id)
    if not listing:
        raise PolicyError("unknown_listing", "Listing not found")
    scan = scan_store(listing["store_id"], listing)  # re-scan: never trust a cached tier from the client
    amount = float(listing["price"])
    reasons: list[str] = []

    with db.connect() as conn:
        user = _user(conn, user_id)
        row = conn.execute("SELECT spent FROM ledger WHERE user_id = ? AND month = ?", (user_id, _month())).fetchone()
        spent = float(row[0]) if row else 0.0

        warnings: list[str] = []
        if scan["tier"] == "blocked":
            outcome = "deny"
            reasons.append(f"{scan['store']['name']} is blocked: " + (scan["reasons"][0]["text"] if scan["reasons"] else "low trust"))
        elif spent + amount > user["cap"]:
            outcome = "deny"
            reasons.append(f"Monthly cap ${user['cap']:.0f} would be exceeded (spent ${spent:.0f})")
        elif not user["verified"]:
            # Identity is verified once (at signup or first purchase), never per purchase.
            outcome = "verify"
            reasons.append("One-time identity check before Warden can buy for you")
        else:
            outcome = "allow"
            reasons.append("Identity verified and store signals checked")
        if outcome != "deny":
            if amount > user["limit"]:
                warnings.append(f"Over your usual ${user['limit']:.0f} per purchase")
            if scan["tier"] == "caution":
                warnings.append("Store is in Caution tier: " + (scan["reasons"][0]["text"] if scan["reasons"] else "check the reasons"))

        decision_id = "dec_" + uuid.uuid4().hex[:16]
        conn.execute(
            "INSERT INTO decisions (id, request_id, user_id, listing_id, amount, outcome, used, created_at) VALUES (?,?,?,?,?,?,0,?)",
            (decision_id, request_id, user_id, listing_id, amount, outcome, _now()),
        )

    decision = {
        "decision_id": decision_id,
        "outcome": outcome,
        "reasons": reasons,
        "warnings": warnings,
        "listing_id": listing_id,
        "store": scan["store"],
        "tier": scan["tier"],
        "score": scan["score"],
        "score_reasons": [r["text"] for r in scan["reasons"]][:3],
        "amount": amount,
    }
    write_audit_event(request_id, "check_policy", "code", decision)
    return decision


def verify_identity(user_id: str, inquiry_id: str) -> dict:
    """One-time Persona verification (signup). The server checks the inquiry, never the browser's word."""
    if not persona.is_passed(inquiry_id):
        raise PolicyError("verification_failed", "Identity verification not completed")
    with db.connect() as conn:
        conn.execute("UPDATE users SET verified = 1, persona_inquiry_id = ? WHERE id = ?", (inquiry_id, user_id))
    write_audit_event(f"user_{user_id}", "identity_verified", "persona", {"inquiry_id": inquiry_id})
    return {"verified": True}


def get_profile(user_id: str) -> dict:
    with db.connect() as conn:
        u = _user(conn, user_id)
    return {"verified": u["verified"], "per_purchase_limit": u["limit"], "monthly_cap": u["cap"]}


def place_order(user_id: str, decision_id: str, verification_id: str | None = None) -> dict:
    """Simulated checkout. A decision can be used once; verify decisions need a passed Persona inquiry."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT request_id, user_id, listing_id, amount, outcome, used, created_at FROM decisions WHERE id = ?",
            (decision_id,),
        ).fetchone()
        if not row:
            raise PolicyError("unknown_decision", "Not charged: decision not found")
        request_id, d_user, listing_id, amount, outcome, used, created_at = row
        if d_user != user_id:
            raise PolicyError("forbidden", "Not charged: decision belongs to another user")
        if outcome == "deny":
            raise PolicyError("denied", "Not charged: this purchase was denied by your rules")
        # A decision is a quote, not a guarantee: re-check age, store and price at pay time.
        if datetime.now(timezone.utc) - datetime.fromisoformat(created_at) > DECISION_TTL:
            raise PolicyError("expired", "Not charged: this check expired, please review it again")
        listing = listing_by_id(listing_id)
        if (not listing or float(listing["price"]) != float(amount)
                or scan_store(listing["store_id"], listing)["tier"] == "blocked"):
            raise PolicyError("denied", "Not charged: the store or price changed since you checked")
        if outcome == "verify":
            if not verification_id or not persona.is_passed(verification_id):
                raise PolicyError("verification_required", "Not charged: identity verification required")
            conn.execute("UPDATE users SET verified = 1, persona_inquiry_id = ? WHERE id = ?", (verification_id, user_id))

        # Single use, even with concurrent requests: only one UPDATE can flip used 0 -> 1.
        cur = conn.execute("UPDATE decisions SET used = 1, verification_id = ? WHERE id = ? AND used = 0",
                           (verification_id, decision_id))
        if cur.rowcount != 1:
            raise PolicyError("already_used", "Not charged again: this decision was already used")

        month = _month()
        conn.execute("INSERT OR IGNORE INTO ledger (user_id, month, spent) VALUES (?, ?, 0)", (user_id, month))
        cap = _user(conn, user_id)["cap"]
        # Atomic cap check: parallel or stockpiled decisions can't add up past the monthly cap.
        cur = conn.execute("UPDATE ledger SET spent = spent + ? WHERE user_id = ? AND month = ? AND spent + ? <= ?",
                           (amount, user_id, month, amount, cap))
        if cur.rowcount != 1:  # raising rolls back the used flag (and any verification) too
            raise PolicyError("denied", "Not charged: your monthly cap would be exceeded")
        purchase_id = "pur_" + uuid.uuid4().hex[:16]
        conn.execute(
            "INSERT INTO purchases (id, request_id, user_id, listing_id, amount, status, decision_id, verification_id, created_at)"
            " VALUES (?,?,?,?,?,'placed',?,?,?)",
            (purchase_id, request_id, user_id, listing_id, amount, decision_id, verification_id, _now()),
        )

    order = {"purchase_id": purchase_id, "decision_id": decision_id, "listing_id": listing_id,
             "amount": float(amount), "status": "placed", "simulated": True, "verification_id": verification_id}
    write_audit_event(request_id, "place_order", "code", order)
    return order
