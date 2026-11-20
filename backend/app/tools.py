"""Tool layer. Plain code turns raw store facts into structured signals.

Seller-controlled text (titles, policy text) is returned only as quoted data
under `untrusted_text`; it never feeds a signal or a score.
"""
from __future__ import annotations

import json
from datetime import date
from urllib.parse import urlparse

from . import db
from .scoring import score_store

NEW_DOMAIN_DAYS = 90
PRICE_TOO_LOW_PCT = 35
IRREVERSIBLE = {"crypto", "wire", "zelle", "gift_card"}
OFFICIAL_BRANDS = {
    "apple": {"apple.com"},
    "best buy": {"bestbuy.com"},
    "bestbuy": {"bestbuy.com"},
    "amazon": {"amazon.com"},
}


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def search_listings(query: str, limit: int = 10) -> list[dict]:
    """Find listings for a product. Matching is deliberately simple for the demo."""
    words = [w for w in query.lower().replace("-", " ").split() if len(w) > 2]
    with db.connect() as conn:
        rows = _rows(conn, "SELECT l.*, s.name AS store_name, s.domain FROM listings l JOIN stores s ON s.id = l.store_id")
    def hit(r):
        hay = f"{r['product']} {r['title']}".lower()
        return any(w in hay for w in words) if words else True
    return [r for r in rows if hit(r)][:limit]


def find_linked_flagged(conn, store: dict) -> list[dict]:
    """Fraud-ring check: stores sharing address, email, phone or policy text with a flagged store.
    This is the query that runs on SingleStore in the demo."""
    return _rows(
        conn,
        """
        SELECT f.id, f.name,
          CASE WHEN f.address <> '' AND f.address = s.address THEN 'address'
               WHEN f.email <> '' AND f.email = s.email THEN 'email'
               WHEN f.phone <> '' AND f.phone = s.phone THEN 'phone'
               ELSE 'policy text' END AS attribute
        FROM stores s
        JOIN stores f ON f.flagged = 1 AND f.id <> s.id
        LEFT JOIN store_policies sp ON sp.store_id = s.id
        LEFT JOIN store_policies fp ON fp.store_id = f.id
        WHERE s.id = ?
          AND ((f.address <> '' AND f.address = s.address)
            OR (f.email <> '' AND f.email = s.email)
            OR (f.phone <> '' AND f.phone = s.phone)
            OR (fp.policy_text <> '' AND fp.policy_text = sp.policy_text))
        """,
        (store["id"],),
    )


def _brand_impersonated(name: str, domain: str) -> str | None:
    n = name.lower()
    d = (domain or "").lower()
    for brand, official in OFFICIAL_BRANDS.items():
        if brand in n and not any(d == o or d.endswith("." + o) for o in official):
            return brand.title()
    return None


def scan_store(store_id: str, listing: dict | None = None) -> dict:
    """Collect signals for one store and score it. Returns structured data only."""
    with db.connect() as conn:
        stores = _rows(conn, "SELECT * FROM stores WHERE id = ?", (store_id,))
        if not stores:
            raise KeyError(store_id)
        store = stores[0]
        pol = (_rows(conn, "SELECT * FROM store_policies WHERE store_id = ?", (store_id,)) or [{}])[0]
        facts_rows = _rows(conn, "SELECT params FROM store_signals WHERE store_id = ? AND signal = 'facts'", (store_id,))
        facts = json.loads(facts_rows[0]["params"]) if facts_rows else {}
        extra = _rows(conn, "SELECT signal, params, source, evidence_url FROM store_signals WHERE store_id = ? AND signal <> 'facts'", (store_id,))
        linked = find_linked_flagged(conn, store)
        ref = None
        if listing:
            refs = _rows(conn, "SELECT * FROM reference_prices WHERE product = ?", (listing["product"],))
            ref = refs[0] if refs else None

    signals: list[dict] = []
    if store.get("flagged"):
        signals.append({"signal": "store_reported", "source": "user reports"})
    for l in linked:
        signals.append({"signal": "linked_to_reported", "params": {"attribute": l["attribute"], "other": l["name"]},
                        "source": "fraud-ring SQL (SingleStore)"})
    brand = _brand_impersonated(store["name"], store.get("domain", ""))
    if brand:
        signals.append({"signal": "brand_impersonation", "params": {"brand": brand}, "source": "domain vs official brand list"})
    if facts.get("domain_created"):
        age = (date.today() - date.fromisoformat(facts["domain_created"])).days
        if age < NEW_DOMAIN_DAYS:
            signals.append({"signal": "new_domain", "params": {"days": age}, "source": "RDAP"})
    payments = set(json.loads(pol.get("accepted_payments") or "[]"))
    if payments and payments <= IRREVERSIBLE:
        signals.append({"signal": "irreversible_payments_only",
                        "params": {"methods": ", ".join(sorted(payments)).replace("_", " ")}, "source": "store policy"})
    if store.get("platform") == "amazon" and (facts.get("seller_months", 99) < 6 or facts.get("seller_ratings", 999) < 50):
        signals.append({"signal": "new_marketplace_seller",
                        "params": {"detail": f"{facts.get('seller_months')} months, {facts.get('seller_ratings')} ratings"},
                        "source": "marketplace profile"})
    if not (pol.get("return_policy") or "").strip() and not (pol.get("contact_address") or "").strip():
        signals.append({"signal": "no_returns_or_contact", "source": "store policy"})
    if listing and ref:
        typical = float(ref["typical_price"])
        price = float(listing["price"])
        pct = round((typical - price) / typical * 100)
        if pct > PRICE_TOO_LOW_PCT:
            signals.append({"signal": "price_too_low", "params": {"pct": pct}, "source": ref["source"]})
        disc = listing.get("advertised_discount")
        if disc:
            claimed_original = price / (1 - float(disc) / 100)
            history_max = max(json.loads(ref["price_history"] or "[0]") or [typical])
            if claimed_original > history_max * 1.10:
                signals.append({"signal": "fake_discount", "source": "price history"})
    for e in extra:  # seeded/live extra signals (e.g. safe_browsing_hit)
        signals.append({"signal": e["signal"], "params": json.loads(e["params"] or "{}"),
                        "source": e["source"] or "", "evidence_url": e["evidence_url"] or ""})

    result = score_store(store_id, signals).to_dict()
    result["store"] = {"id": store["id"], "name": store["name"], "domain": store.get("domain")}
    result["linked_stores"] = linked
    result["untrusted_text"] = {  # quoted data for the LLM to describe, never to obey
        "listing_title": (listing or {}).get("title", ""),
        "policy_text": pol.get("policy_text") or "",
    }
    return result


def listing_by_id(listing_id: str) -> dict | None:
    with db.connect() as conn:
        rows = _rows(conn, "SELECT * FROM listings WHERE id = ?", (listing_id,))
    return rows[0] if rows else None


def domain_of(url: str) -> str:
    host = urlparse(url if "://" in url else "https://" + url).hostname or ""
    return host.removeprefix("www.")
