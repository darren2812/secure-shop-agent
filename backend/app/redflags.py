"""Read-only store trust list: every store with its code-computed score, red flags (blocked/caution) first.

Plain code only: the same scan_store/score_store path the agent uses, offline (network=False). No LLM,
no writes. Seller-controlled text never goes out raw: names go through safe_name, reasons are fixed
templates (capped in length).
"""
from __future__ import annotations

from . import db
from .tools import safe_name, scan_store

_TIER_ORDER = {"blocked": 0, "caution": 1, "trusted": 2}


def _all(sql: str) -> list[dict]:
    with db.connect() as conn:
        cur = conn.execute(sql)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def red_flags() -> dict:
    stores = _all("SELECT id, name, domain FROM stores")
    listings = _all("SELECT * FROM listings")
    refs = {r["product"]: float(r["typical_price"]) for r in _all("SELECT product, typical_price FROM reference_prices")}
    by_store: dict[str, list[dict]] = {}
    for l in listings:
        by_store.setdefault(l["store_id"], []).append(l)

    out = []
    for s in stores:
        # A store can sell several things: report its worst-scoring listing (or the store alone if it has none).
        scans = [(scan_store(s["id"], l, network=False), l) for l in by_store.get(s["id"], [])] \
            or [(scan_store(s["id"], None, network=False), None)]
        scan, listing = min(scans, key=lambda x: (_TIER_ORDER.get(x[0]["tier"], 2), x[0]["score"]))
        item = {"store_id": s["id"], "name": safe_name(s["name"]), "domain": str(s.get("domain") or "")[:80],
                "tier": scan["tier"], "score": scan["score"], "price": None,
                "reasons": [{"code": r["code"], "text": str(r["text"])[:160]} for r in scan["reasons"]]}
        if listing:
            price = float(listing["price"])
            item["price"] = price
            typical = refs.get(listing["product"])
            if typical:
                item["typical_price"] = typical
                if typical > price:
                    item["pct_below"] = round((typical - price) / typical * 100)
        out.append(item)
    out.sort(key=lambda i: (_TIER_ORDER.get(i["tier"], 3), i["score"], i["name"]))
    return {"stores": out}
