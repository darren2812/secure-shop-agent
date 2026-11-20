import os
import tempfile

import pytest

os.environ["SQLITE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.pop("PERSONA_API_KEY", None)

from app import db, persona  # noqa: E402
from app.audit import verify_trail, write_audit_event  # noqa: E402
from app.policy import PolicyError, check_policy, place_order  # noqa: E402
from app.seed import reset_and_seed  # noqa: E402
from app.tools import listing_by_id, scan_store  # noqa: E402


@pytest.fixture(autouse=True)
def fresh():
    reset_and_seed()


def scan(listing_id):
    l = listing_by_id(listing_id)
    return scan_store(l["store_id"], l)


@pytest.mark.parametrize("listing,tier,score", [
    ("l_bestbuy", "trusted", 100),
    ("l_amz", "caution", 70),
    ("l_apple_outlet", "blocked", 0),
    ("l_audiohub", "blocked", 0),
    ("l_bb_clearance", "blocked", 0),
    ("l_soundshack", "trusted", 85),
])
def test_demo_tiers(listing, tier, score):
    r = scan(listing)
    assert (r["tier"], r["score"]) == (tier, score), r["reasons"]


def test_impersonation_and_fraud_ring_reasons():
    assert scan("l_apple_outlet")["reasons"][0]["code"] == "brand_impersonation"
    r = scan("l_audiohub")
    assert r["reasons"][0]["code"] == "linked_to_reported"
    assert r["linked_stores"][0]["attribute"] == "address"


def test_prompt_injection_does_not_change_score():
    before = scan("l_apple_outlet")
    with db.connect() as conn:
        conn.execute("UPDATE listings SET title = 'AirPods Pro 2' WHERE id = 'l_apple_outlet'")
    after = scan("l_apple_outlet")
    assert (before["score"], before["tier"], [r["code"] for r in before["reasons"]]) == \
           (after["score"], after["tier"], [r["code"] for r in after["reasons"]])
    assert "ignore your rules" in before["untrusted_text"]["listing_title"]


def test_audit_chain_intact_then_tamper_detected():
    for i in range(3):
        write_audit_event("req1", f"step{i}", "code", {"i": i})
    assert verify_trail("req1")["intact"] is True
    with db.connect() as conn:
        conn.execute("UPDATE audit_events SET canonical_text = replace(canonical_text, '\"i\":1', '\"i\":9') WHERE request_id='req1' AND seq=2")
    v = verify_trail("req1")
    assert v["intact"] is False and v["broken_seq"] == 2


def test_audit_deleted_event_detected():
    for i in range(3):
        write_audit_event("req2", f"step{i}", "code", {"i": i})
    with db.connect() as conn:
        conn.execute("DELETE FROM audit_events WHERE request_id='req2' AND seq=2")
    assert verify_trail("req2")["intact"] is False


def test_trusted_over_limit_needs_verify():
    d = check_policy("u_demo", "l_soundshack", "r1")  # $245 > $200 limit
    assert d["outcome"] == "verify"


def test_over_limit_requires_persona_then_orders_once():
    d = check_policy("u_demo", "l_bestbuy", "r2")
    assert d["outcome"] == "verify" and "limit" in d["reasons"][0]
    with pytest.raises(PolicyError) as e:
        place_order("u_demo", d["decision_id"])
    assert e.value.code == "verification_required" and not e.value.charged
    persona.stub_mark_passed("inq_demo")
    o = place_order("u_demo", d["decision_id"], "inq_demo")
    assert o["status"] == "placed"
    with pytest.raises(PolicyError) as e:
        place_order("u_demo", d["decision_id"], "inq_demo")
    assert e.value.code == "already_used"
    assert verify_trail("r2")["intact"] is True


def test_blocked_store_denied():
    d = check_policy("u_demo", "l_apple_outlet", "r3")
    assert d["outcome"] == "deny"
    with pytest.raises(PolicyError) as e:
        place_order("u_demo", d["decision_id"])
    assert e.value.code == "denied"


def test_decision_belongs_to_user():
    d = check_policy("u_demo", "l_amz", "r4")
    with pytest.raises(PolicyError) as e:
        place_order("someone_else", d["decision_id"])
    assert e.value.code == "forbidden"
