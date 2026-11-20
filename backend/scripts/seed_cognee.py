"""Seed structured graph with backend STOPPED (embedded storage is single-process).

From backend, install requirements-cognee.txt, then set absolute
SYSTEM_ROOT_DIRECTORY and DATA_ROOT_DIRECTORY (use the same paths for the API),
TELEMETRY_DISABLED=true and run: .venv/bin/python scripts/seed_cognee.py
--spike writes two probe stores; use separate temporary directories for it.
No SQL resets, LLM extraction, vector writes, or API credentials are needed.
"""
from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.graph import configure_storage, graph_indices, node_id, normalize  # noqa: E402


def data_points(rows):
    # Keep Cognee optional for the API, tests, and CLI --help.
    from cognee.infrastructure.engine import DataPoint

    class Address(DataPoint):
        value_norm: str
        metadata: dict = {"index_fields": []}

    class Email(DataPoint):
        value_norm: str
        metadata: dict = {"index_fields": []}

    class Phone(DataPoint):
        value_e164: str
        metadata: dict = {"index_fields": []}

    class Store(DataPoint):
        store_id: str
        name: str
        address: Address | None = None
        email: Email | None = None
        phone: Phone | None = None
        metadata: dict = {"index_fields": []}

    points = []
    for row in rows:
        attrs = {}
        for kind, model in (("address", Address), ("email", Email), ("phone", Phone)):
            value = normalize(kind, row.get(kind))
            if value:
                field = "value_e164" if kind == "phone" else "value_norm"
                attrs[kind] = model(id=node_id(kind, value), **{field: value})
        points.append(Store(id=node_id("store", row["id"]), store_id=row["id"],
                            name=row["name"], **attrs))
    return points


async def seed(spike=False):
    configure_storage()
    from cognee.tasks.storage import add_data_points
    from cognee.infrastructure.databases.graph import get_graph_engine

    if spike:
        rows = [{"id": sid, "name": sid, "address": "1 Main St."}
                for sid in ("probe_a", "probe_b")]
    else:
        from app import db
        with db.connect() as conn:
            cursor = conn.execute("SELECT id, name, address, email, phone FROM stores WHERE is_seeded = 1")
            rows = [dict(zip([c[0] for c in cursor.description], r)) for r in cursor.fetchall()]
        if not rows:
            raise ValueError("No seeded SQL stores; initialize shopping data first")
    await add_data_points(data_points(rows), graph_only=True)
    engine = await get_graph_engine()
    nodes, edges = await engine.get_graph_data()
    by_store, by_attr = graph_indices(nodes, edges)
    if spike:
        shared = set(by_store["probe_a"]) & set(by_store["probe_b"])
        assert len(shared) == 1 and len(by_attr[next(iter(shared))]) == 2
        assert len([1 for _, props in nodes if props.get("type") == "Address"]) == 1
        assert len(edges) == 2
        print("Spike passed: one fixed-ID Address node, two Store edges.")
    else:
        assert all(row["id"] in by_store for row in rows)
        print(f"Seeded {len(rows)} stores; graph has {len(nodes)} nodes and {len(edges)} edges.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spike", action="store_true")
    args = parser.parse_args()
    load_dotenv(BACKEND / ".env")
    asyncio.run(seed(args.spike))


if __name__ == "__main__":
    main()
