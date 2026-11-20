"""Store trust scoring. Plain code: the LLM never sets or changes a score.

Weights live here, not in the database, so seeded data can't rewrite the rules.
"""
from __future__ import annotations

from dataclasses import dataclass, field

START_SCORE = 100
TRUSTED_MIN = 75
CAUTION_MIN = 50

# Hard gates: any one of these blocks the store regardless of score.
HARD_GATES = {
    "safe_browsing_hit": "Listed on Google Safe Browsing",
    "store_reported": "Store was reported by a user",
    "linked_to_reported": "Shares {attribute} with reported store {other}",
    "brand_impersonation": "Imitates {brand} on a non-official domain",
}

# Penalties, applied when the signal is present.
PENALTIES = {
    "new_domain": (-30, "Domain is {days} days old"),
    "irreversible_payments_only": (-30, "Only accepts {methods}"),
    "new_marketplace_seller": (-30, "New marketplace seller ({detail})"),
    "price_too_low": (-20, "Price is {pct}% below typical"),
    "no_returns_or_contact": (-15, "No return policy or contact address"),
    "fake_discount": (-10, "Advertised discount not supported by price history"),
}


@dataclass
class Reason:
    code: str
    text: str
    weight: int | None  # None for hard gates
    source: str = ""
    evidence_url: str = ""


@dataclass
class StoreScore:
    store_id: str
    score: int
    tier: str  # trusted | caution | blocked
    reasons: list[Reason] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "store_id": self.store_id,
            "score": self.score,
            "tier": self.tier,
            "reasons": [r.__dict__ for r in self.reasons],
        }


def _fmt(template: str, params: dict) -> str:
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template


def tier_for(score: int) -> str:
    if score >= TRUSTED_MIN:
        return "trusted"
    if score >= CAUTION_MIN:
        return "caution"
    return "blocked"


def score_store(store_id: str, signals: list[dict]) -> StoreScore:
    """Score one store from structured signals.

    Each signal: {"signal": code, "params": {...}, "source": str, "evidence_url": str}.
    Unknown codes are ignored on purpose: free text in a signal can never move the score.
    """
    reasons: list[Reason] = []
    gated = False
    score = START_SCORE
    seen: set[str] = set()

    for s in signals:
        code = s.get("signal")
        if code in seen:
            continue
        params = s.get("params") or {}
        src = str(s.get("source", ""))
        url = str(s.get("evidence_url", ""))
        if code in HARD_GATES:
            seen.add(code)
            gated = True
            reasons.append(Reason(code, _fmt(HARD_GATES[code], params), None, src, url))
        elif code in PENALTIES:
            seen.add(code)
            weight, template = PENALTIES[code]
            score += weight
            reasons.append(Reason(code, _fmt(template, params), weight, src, url))

    score = max(0, min(START_SCORE, score))
    tier = "blocked" if gated else tier_for(score)
    # Hard gates first, then biggest penalties, so the top reasons are the important ones.
    reasons.sort(key=lambda r: (r.weight is not None, r.weight or 0))
    return StoreScore(store_id, 0 if gated else score, tier, reasons)
