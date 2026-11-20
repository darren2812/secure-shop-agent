"""Append-only, hash-chained audit log.

Only write_audit_event() inserts rows; nothing updates or deletes them.
The hashed bytes are stored verbatim as TEXT (canonical_text) so the database
can't normalize JSON or timestamps and break verification.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
from datetime import datetime, timezone

from . import db

GENESIS = "GENESIS"
ACTORS = {"agent", "code", "user", "persona", "system"}

_lock = threading.Lock()  # one writer at a time keeps seq and prev_hash consistent


def canonical(obj: dict) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(prev_hash: str, canonical_text: str) -> str:
    """HMAC-SHA256 with a server-only key when AUDIT_HMAC_KEY is set (someone with DB access can't
    re-forge the chain); plain SHA-256 otherwise so the demo runs without config."""
    msg = f"{prev_hash}|{canonical_text}".encode("utf-8")
    key = os.environ.get("AUDIT_HMAC_KEY", "")
    if key:
        return hmac.new(key.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return hashlib.sha256(msg).hexdigest()


def write_audit_event(request_id: str, step: str, actor: str, payload: dict) -> dict:
    if actor not in ACTORS:
        raise ValueError(f"unknown actor {actor!r}")
    with _lock, db.connect() as conn:
        last = conn.execute(
            "SELECT seq, hash FROM audit_events WHERE request_id = ? ORDER BY seq DESC LIMIT 1",
            (request_id,),
        ).fetchone()
        seq = (last[0] + 1) if last else 1
        prev_hash = last[1] if last else GENESIS
        event = {
            "request_id": request_id,
            "seq": seq,
            "ts": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
            "step": step,
            "actor": actor,
            "payload": payload,
        }
        text = canonical(event)
        h = compute_hash(prev_hash, text)
        conn.execute(
            "INSERT INTO audit_events (request_id, seq, canonical_text, prev_hash, hash) VALUES (?, ?, ?, ?, ?)",
            (request_id, seq, text, prev_hash, h),
        )
    return {**event, "prev_hash": prev_hash, "hash": h}


def get_trail(request_id: str) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT seq, canonical_text, prev_hash, hash FROM audit_events WHERE request_id = ? ORDER BY seq",
            (request_id,),
        ).fetchall()
    trail = []
    for seq, text, prev_hash, h in rows:
        try:
            event = json.loads(text)
        except json.JSONDecodeError:
            event = {"seq": seq, "unparseable": True}
        trail.append({**event, "prev_hash": prev_hash, "hash": h})
    return trail


def verify_trail(request_id: str) -> dict:
    """Recompute every hash in order. Returns intact or the first broken event."""
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT seq, canonical_text, prev_hash, hash FROM audit_events WHERE request_id = ? ORDER BY seq",
            (request_id,),
        ).fetchall()
    if not rows:
        return {"intact": False, "events": 0, "reason": "no events"}
    expected_prev = GENESIS
    for i, (seq, text, prev_hash, h) in enumerate(rows, start=1):
        if seq != i:
            return {"intact": False, "events": len(rows), "broken_seq": i, "reason": "missing or reordered event"}
        if prev_hash != expected_prev:
            return {"intact": False, "events": len(rows), "broken_seq": seq, "reason": "chain link mismatch"}
        if compute_hash(prev_hash, text) != h:
            return {"intact": False, "events": len(rows), "broken_seq": seq, "reason": "event content was altered"}
        expected_prev = h
    return {"intact": True, "events": len(rows), "head": expected_prev}
