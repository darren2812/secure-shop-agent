"""Senso supplies cited policy penalties, never answers or positive trust signals."""
from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
from dataclasses import replace

import httpx

from . import db

BASE_URL = "https://apiv2.senso.ai/api/v1"
log = logging.getLogger(__name__)
RED_FLAGS = {
    r"(?i)all sales (are )?final": "all sales final",
    r"(?i)no (returns|refunds)": "no returns",
    r"(?i)non-?refundable": "non-refundable",
    r"(?i)store credit only": "store credit only",
    r"(?i)restocking fee of (2[5-9]|[3-9]\d)%": "restocking fee of 25% or more",
}


class SensoProvider:
    name = "senso"

    def __init__(self, *, transport=None, clock=time.monotonic):
        self.transport = transport
        self.clock = clock
        self.status = "off"
        self._cache = {}
        self._lock = threading.Lock()
        self._request_locks = {}
        self._generation = 0

    def enabled(self):
        if not os.environ.get("SENSO_API_KEY"):
            return False
        with db.connect() as conn:
            return bool(conn.execute("SELECT 1 FROM senso_docs LIMIT 1").fetchone())

    async def startup(self):
        self.reset()

    def reset(self):
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._cache.clear()
            self.status = "off"
        if self.enabled():
            threading.Thread(target=self._warm, args=(generation,), daemon=True,
                             name="senso-warm").start()

    def _warm(self, generation):
        try:
            with db.connect() as conn:
                stores = conn.execute(
                    "SELECT DISTINCT s.id, s.name FROM stores s JOIN senso_docs d ON d.store_id = s.id"
                ).fetchall()
            failed = False
            for store_id, name in stores:
                with self._lock:
                    if generation != self._generation:
                        return
                failed |= self.signals({"id": store_id, "name": name}, [], True).status == "error"
            if failed:
                self.status = "error"
        except Exception:
            self.status = "error"
            log.warning("Senso cache warm failed")

    def signals(self, store, flagged, network):
        from .extras import ExtraResult

        # The per-store lookup below also determines whether docs are present.
        if not os.environ.get("SENSO_API_KEY"):
            return ExtraResult([], "off", {}, {})
        with db.connect() as conn:
            docs = conn.execute(
                "SELECT content_id, title, url FROM senso_docs WHERE store_id = ? ORDER BY content_id",
                (store["id"],),
            ).fetchall()
        if not docs:
            return ExtraResult([], "off", {}, {})
        signature = tuple(docs)
        with self._lock:
            cached = self._cache.get(store["id"])
            if cached and cached[0] > self.clock() and cached[1] == signature:
                self.status = "cached"
                return replace(cached[2], status="cached")
            request_lock = self._request_locks.setdefault(store["id"], threading.Lock())
        # Checkout never waits on an in-flight request, nor performs network I/O.
        if not network:
            return ExtraResult([], "off", {}, {})
        with request_lock:
            with self._lock:
                generation = self._generation
                cached = self._cache.get(store["id"])
                if cached and cached[0] > self.clock() and cached[1] == signature:
                    self.status = "cached"
                    return replace(cached[2], status="cached")
            try:
                result = self._search(store, docs)
                ttl = float(os.environ.get("SENSO_CACHE_TTL_S", "900"))
                with self._lock:
                    if generation == self._generation:
                        self._cache[store["id"]] = (self.clock() + ttl, signature, result)
            except httpx.HTTPStatusError as exc:
                # Never log request headers, response bodies, or seller text.
                log.warning("Senso search failed (HTTP %s)%s", exc.response.status_code,
                            ": out of credits" if exc.response.status_code == 402 else "")
                result = ExtraResult([], "error", {}, {})
            except Exception:
                log.warning("Senso search failed")
                result = ExtraResult([], "error", {}, {})
            self.status = result.status
            return result

    def _search(self, store, docs):
        from .extras import ExtraResult

        by_id = {content_id: (title, url) for content_id, title, url in docs}
        payload = {"query": f"{store['name']} return policy refunds restrictions", "max_results": 20}
        scope = os.environ.get("SENSO_SCOPE_FIELD", "content_ids").strip()
        if scope:
            payload[scope] = list(by_id)
            if scope == "content_ids":
                payload["require_scoped_ids"] = True
        with httpx.Client(base_url=BASE_URL, transport=self.transport,
                          headers={"X-API-Key": os.environ["SENSO_API_KEY"]},
                          timeout=float(os.environ.get("SENSO_TIMEOUT_S", "4"))) as client:
            response = client.post("/org/search/context", json=payload)
            response.raise_for_status()
            passages = response.json()["results"]
        minimum = float(os.environ.get("SENSO_MIN_SCORE", "0.35"))
        for passage in passages:
            content_id = passage.get("content_id")
            if content_id not in by_id:
                continue
            score = float(passage.get("score", 0))
            if not math.isfinite(score) or score < minimum:
                continue
            text = passage.get("chunk_text", "")
            for pattern, label in RED_FLAGS.items():
                match = re.search(pattern, text)
                if match:
                    # Titles and URLs come from our mapping, never retrieved text.
                    title, url = by_id[content_id]
                    start = max(0, match.start() - 80)
                    return ExtraResult(
                        [{"signal": "policy_red_flag", "params": {"phrase": label},
                          "source": f"Senso: {title}", "evidence_url": url or ""}],
                        "live", {"senso_passage": text[start:start + 300]},
                        {"content_id": content_id, "title": title, "score": score},
                    )
        return ExtraResult([], "live", {}, {})
