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


def test_unverified_user_verifies_once_then_buys_without_friction():
    d = check_policy("u_demo", "l_bestbuy", "r2")
    assert d["outcome"] == "verify" and "One-time" in d["reasons"][0]
    assert any("usual $200" in w for w in d["warnings"])  # over limit is a warning, not a gate
    with pytest.raises(PolicyError) as e:
        place_order("u_demo", d["decision_id"])
    assert e.value.code == "verification_required" and not e.value.charged
    persona.stub_mark_passed("inq_demo")
    o = place_order("u_demo", d["decision_id"], "inq_demo")
    assert o["status"] == "placed"
    with pytest.raises(PolicyError) as e:
        place_order("u_demo", d["decision_id"], "inq_demo")
    assert e.value.code == "already_used"
    # second purchase: already verified, no step-up
    d2 = check_policy("u_demo", "l_soundshack", "r2b")
    assert d2["outcome"] == "allow"
    assert place_order("u_demo", d2["decision_id"])["status"] == "placed"
    assert verify_trail("r2")["intact"] is True


def test_signup_verification_then_allow():
    from app.policy import verify_identity
    with pytest.raises(PolicyError):
        verify_identity("u_demo", "inq_never_completed")
    persona.stub_mark_passed("inq_signup")
    verify_identity("u_demo", "inq_signup")
    assert check_policy("u_demo", "l_amz", "r5")["outcome"] == "allow"


def test_monthly_cap_still_denies():
    persona.stub_mark_passed("inq_cap")
    from app.policy import verify_identity
    verify_identity("u_demo", "inq_cap")
    for i, l in enumerate(["l_bestbuy", "l_soundshack"]):
        place_order("u_demo", check_policy("u_demo", l, f"rc{i}")["decision_id"])
    assert check_policy("u_demo", "l_amz", "rc3")["outcome"] == "deny"  # 249+245+229 > 600


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
