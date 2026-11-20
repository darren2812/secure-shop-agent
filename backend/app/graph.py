"""Optional Cognee graph: load once, walk locally using live SQL reports."""
from __future__ import annotations

import asyncio
import logging
import os
import re
from collections import defaultdict
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

NS = uuid5(NAMESPACE_URL, "shop-agent/store-graph/v1")
log = logging.getLogger("uvicorn.error")


def normalize(kind: str, value: str) -> str:
    value = (value or "").strip().lower()
    if kind == "address":
        words = re.sub(r"[^\w\s]", " ", value).split()
        return " ".join({"st": "street", "ave": "avenue"}.get(w, w) for w in words)
    if kind == "phone":
        digits = re.sub(r"\D", "", value)
        if len(digits) == 10:
            digits = "1" + digits
        return "+" + digits if 8 <= len(digits) <= 15 else ""
    return value


def node_id(kind: str, value: str):
    return uuid5(NS, f"{kind}:{value}")


def configure_storage() -> None:
    """Require explicit persistent locations before Cognee can open embedded stores."""
    for key in ("SYSTEM_ROOT_DIRECTORY", "DATA_ROOT_DIRECTORY"):
        if not os.environ.get(key) or not Path(os.environ[key]).is_absolute():
            raise ValueError(f"{key} must be an absolute path")
    # Cognee 1.6 reloads .env with override=True on import. An empty file
    # preserves our database guards and explicit provider settings.
    os.environ["COGNEE_ENV_FILE"] = str(Path(__file__).with_name("cognee.env"))
    os.environ["TELEMETRY_DISABLED"] = "true"


def two_hop(store_id, flagged_ids, attrs_by_store, stores_by_attr):
    """Return one deterministic indirect path, excluding self and direct links."""
    own = set(attrs_by_store.get(store_id, ()))
    flagged = set(flagged_ids) - {store_id}
    # A direct reported neighbour already triggers the stronger SQL gate.
    if any(own.intersection(attrs_by_store.get(other, ())) for other in flagged):
        return None
    for first in sorted(own):
        for via in sorted(stores_by_attr.get(first, ())):
            if via == store_id:
                continue
            for second in sorted(attrs_by_store.get(via, ())):
                for other in sorted(flagged & set(stores_by_attr.get(second, ()))):
                    return {"store_id": store_id, "via": via, "other": other,
                            "attributes": [first, second]}
    return None


def graph_indices(nodes, edges):
    """Cognee 1.6 nodes=(id, properties); edges=(src, dst, label, properties)."""
    stores, attributes = {}, {}
    for uid, props in nodes:
        kind = props.get("type", "").lower()
        if kind == "store" and props.get("store_id"):
            stores[str(uid)] = props["store_id"]
        elif kind in {"address", "email", "phone"}:
            # Attribute values never enter reason text or audit metadata.
            attributes[str(uid)] = (kind, str(uid))
    by_store, by_attr = defaultdict(set), defaultdict(set)
    for source, target, *_ in edges:
        source, target = str(source), str(target)
        if source in attributes and target in stores:
            source, target = target, source
        if source in stores and target in attributes:
            sid, attr = stores[source], attributes[target]
            by_store[sid].add(attr)
            by_attr[attr].add(sid)
    return dict(by_store), dict(by_attr)


async def _read_graph():
    from cognee.infrastructure.databases.graph import get_graph_engine

    engine = await get_graph_engine()
    return await engine.get_graph_data()


class CogneeProvider:
    name = "cognee"

    def __init__(self):
        self.status = "off"
        self.attrs_by_store = {}
        self.stores_by_attr = {}
        self.names = {}

    def enabled(self):
        return os.environ.get("COGNEE_ENABLED") == "1"

    async def startup(self):
        self.status = "error"
        self.attrs_by_store, self.stores_by_attr, self.names = {}, {}, {}
        configure_storage()
        # Cognee imports and embedded reads can block; keep them off the API loop.
        nodes, edges = await asyncio.to_thread(lambda: asyncio.run(_read_graph()))
        attrs, stores = graph_indices(nodes, edges)
        if not attrs:
            raise ValueError("Cognee store graph is not seeded")
        from . import db
        from .tools import safe_name

        with db.connect() as conn:
            self.names = {sid: safe_name(name) for sid, name in
                          conn.execute("SELECT id, name FROM stores").fetchall()}
        self.attrs_by_store, self.stores_by_attr = attrs, stores
        self.status = "live"
        log.info("Cognee graph live: %d stores, %d attributes", len(attrs), len(stores))

    def reset(self):
        pass  # Embedded graph is static; reports are read live by scan_store.

    def signals(self, store, flagged, network):
        from .extras import ExtraResult

        if self.status != "live":
            return ExtraResult([], "error", {}, {})
        flagged_names = {row["id"]: row["name"] for row in flagged}
        path = two_hop(store["id"], flagged_names, self.attrs_by_store, self.stores_by_attr)
        if not path or path["via"] not in self.names or path["other"] not in self.names:
            return ExtraResult([], "live", {}, {})
        signal = {"signal": "linked_two_hops", "source": "Cognee graph",
                  "params": {"via": self.names[path["via"]], "other": flagged_names[path["other"]]}}
        log.info("Cognee: %s linked to reported %s via %s (two hops)",
                 self.names.get(store["id"], store["id"]), flagged_names[path["other"]], self.names[path["via"]])
        first, second = path["attributes"]
        audit = {"path": [path["store_id"], first[0], path["via"], second[0], path["other"]]}
        return ExtraResult([signal], "live", {}, audit)
