"""Tool layer. Plain code turns raw store facts into structured signals.

Seller-controlled text (titles, policy text, provider passages) is returned only
under `untrusted_text`. Optional providers may emit fixed penalty labels.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from urllib.parse import urlparse

from . import db, extras
from .scoring import score_store

NEW_DOMAIN_DAYS = 90
PRICE_TOO_LOW_PCT = 35
IRREVERSIBLE = {"crypto", "wire", "zelle", "gift_card"}
OFFICIAL_BRANDS = {  # keys are normalized: lowercase letters only
    "apple": {"apple.com"},
    "bestbuy": {"bestbuy.com"},
    "amazon": {"amazon.com"},
    "walmart": {"walmart.com"},
    "target": {"target.com"},
    "nintendo": {"nintendo.com"},
}
# Digits, symbols and Cyrillic/Greek letters that look like Latin ones. A short manual table, not full UTS #39.
_LOOKALIKE = str.maketrans({
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
    "$": "s", "@": "a", "|": "l", "!": "i", "\u20ac": "e",
    "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u0451": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h",
    "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0456": "i",
    "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u04cf": "l", "\u0261": "g",
    "\u03b1": "a", "\u03b2": "b", "\u03b5": "e", "\u03b7": "n", "\u03b9": "i", "\u03ba": "k", "\u03bd": "v",
    "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x", "\u03c9": "w",
    "\u0131": "i", "\u0142": "l", "\u00df": "ss", "\u00f8": "o",
})


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


def _norm(s: str) -> str:
    """Fold a store name for brand matching: NFKC, drop accents, map look-alikes, keep only a-z."""
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.translate(_LOOKALIKE))


def _brand_impersonated(name: str, domain: str) -> str | None:
    n = _norm(name)
    # Also try the classic swaps: rn->m, vv->w, and I/l confusion in both directions.
    variants = {n, n.replace("rn", "m").replace("vv", "w"), n.replace("i", "l"), n.replace("l", "i")}
    d = (domain or "").lower().rstrip(".")
    for brand, official in OFFICIAL_BRANDS.items():
        if any(brand in v for v in variants) and not any(d == o or d.endswith("." + o) for o in official):
            return {"bestbuy": "Best Buy"}.get(brand, brand.title())
    return None


def safe_name(s: str) -> str:
    """Seller-chosen display name: keep it a short name, not a sentence, before it reaches the LLM or the voice."""
    clean = re.sub(r"[^\w &'.()-]", "", unicodedata.normalize("NFKC", str(s or "")))
    return " ".join(clean.split())[:40].strip() or "Unnamed store"


def scan_store(store_id: str, listing: dict | None = None, network: bool = True) -> dict:
    """Collect signals for one store and score it. Returns structured data only."""
    with db.connect() as conn:
        stores = _rows(conn, "SELECT * FROM stores WHERE id = ?", (store_id,))
        if not stores:
            raise KeyError(store_id)
        store = stores[0]
        pol = (_rows(conn, "SELECT * FROM store_policies WHERE store_id = ?", (store_id,)) or [{}])[0]
        facts_rows = _rows(conn, "SELECT params FROM store_signals WHERE store_id = ? AND `signal` = 'facts'", (store_id,))
        facts = json.loads(facts_rows[0]["params"]) if facts_rows else {}
        extra = _rows(conn, "SELECT `signal`, params, source, evidence_url FROM store_signals WHERE store_id = ? AND `signal` <> 'facts'", (store_id,))
        linked = [{**l, "name": safe_name(l["name"])} for l in find_linked_flagged(conn, store)]
        flagged = [{**s, "name": safe_name(s["name"])} for s in
                   _rows(conn, "SELECT id, name FROM stores WHERE flagged = 1")]
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

    extra_signals, sources, untrusted, extra_audit = extras.run(store, flagged, network)
    signals.extend(extra_signals)
    result = score_store(store_id, signals).to_dict()
    result["sources"] = {"sql": "live", **sources}
    result["extras_audit"] = extra_audit
    result["store"] = {"id": store["id"], "name": safe_name(store["name"]), "domain": store.get("domain")}
    result["linked_stores"] = linked
    result["untrusted_text"] = {  # quoted data for the LLM to describe, never to obey
        "listing_title": (listing or {}).get("title", ""),
        "policy_text": pol.get("policy_text") or "",
        **untrusted,
    }
    return result


def listing_by_id(listing_id: str) -> dict | None:
    with db.connect() as conn:
        rows = _rows(conn, "SELECT * FROM listings WHERE id = ?", (listing_id,))
    return rows[0] if rows else None


def domain_of(url: str) -> str:
    """Host the browser would actually open. Ambiguous URLs return "" (unknown store), never a vouched one."""
    url = url.strip().replace("\\", "/")  # browsers treat "\" as "/"
    try:
        p = urlparse(url if "://" in url else "https://" + url)
        host = p.hostname or ""
        if p.username is not None or p.password is not None or "@" in p.netloc:  # user@host tricks
            return ""
    except ValueError:
        return ""
    return host.rstrip(".").removeprefix("www.")
