"""Ingest S3 policies once; --spike verifies search scoping with two fake stores.

Run from backend: .venv/bin/python scripts/seed_senso.py --spike
Then: .venv/bin/python scripts/seed_senso.py
Only adds senso_docs mappings; never resets shopping data. Pending uploads are
checkpointed locally so interrupted polling does not cause duplicate ingestion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import httpx
from dotenv import load_dotenv, set_key

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app import db  # noqa: E402
from app.senso import BASE_URL  # noqa: E402


def ingest(client, title, text, state, state_path, *, wait_s=300):
    fingerprint = hashlib.sha256((title + text).encode()).hexdigest()
    if fingerprint not in state:
        response = client.post("/org/kb/raw", json={"title": title, "text": text})
        response.raise_for_status()
        state[fingerprint] = response.json()
        state_path.write_text(json.dumps(state))
    doc = state[fingerprint]
    deadline = time.monotonic() + wait_s
    while True:
        response = client.get(f"/org/kb/nodes/{doc['kb_node_id']}")
        response.raise_for_status()
        node = response.json()
        status = node.get("content", node).get("processing_status")
        if status == "complete":
            return doc["id"]
        if status == "failed":
            raise RuntimeError("Senso document processing failed; check Senso credits and node status")
        if time.monotonic() >= deadline:
            raise RuntimeError("Senso processing timed out; rerun to resume polling")
        time.sleep(5)


def spike(client, state, state_path):
    policies = [("SensoScopeAlpha", "All sales final."),
                ("SensoScopeBeta", "30-day returns to the original payment method.")]
    ids = [ingest(client, f"[S3 scope spike] {name}",
                  f"{name}\nhttps://{name.lower()}.example/returns\n{policy}", state, state_path)
           for name, policy in policies]
    scoped = True
    for index, (content_id, (name, policy)) in enumerate(zip(ids, policies)):
        response = client.post("/org/search/context", json={
            "query": f"{name} {policy}", "max_results": 20,
            "content_ids": [content_id], "require_scoped_ids": True,
        })
        if response.status_code in {400, 422}:
            scoped = False
            break
        response.raise_for_status()
        found = {p.get("content_id") for p in response.json()["results"]}
        if not found:
            raise RuntimeError("Scope spike returned no passages; cannot verify scoping yet")
        scoped &= found == {content_id}
        # A store-name query alone could appear scoped even if the field were
        # ignored. Search for the OTHER store while keeping this scope fixed.
        other_name, other_policy = policies[1 - index]
        response = client.post("/org/search/context", json={
            "query": f"{other_name} {other_policy}", "max_results": 20,
            "content_ids": [content_id], "require_scoped_ids": True,
        })
        response.raise_for_status()
        scoped &= all(p.get("content_id") == content_id for p in response.json()["results"])
    field = "content_ids" if scoped else ""
    set_key(str(BACKEND / ".env"), "SENSO_SCOPE_FIELD", field)
    print(f"Scope spike: {'content_ids verified for both docs' if scoped else 'use local content_id filtering fallback'}")


def seed(client, state, state_path):
    db.init_db()
    for path in sorted((BACKEND / "seed" / "senso").glob("*.txt")):
        store_id = path.stem
        with db.connect() as conn:
            exists = conn.execute("SELECT 1 FROM senso_docs WHERE store_id = ?", (store_id,)).fetchone()
        if exists:
            print(f"{store_id}: already mapped, skipped")
            continue
        text = path.read_text()
        name, url = text.splitlines()[:2]
        title = f"[store:{store_id}] {name} — Returns"
        content_id = ingest(client, title, text, state, state_path)
        with db.connect() as conn:
            conn.execute("INSERT INTO senso_docs (store_id, content_id, title, url) VALUES (?,?,?,?)",
                         (store_id, content_id, title, url))
        print(f"{store_id}: complete, mapping saved")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spike", action="store_true")
    args = parser.parse_args()
    load_dotenv(BACKEND / ".env")
    key = os.environ.get("SENSO_API_KEY")
    if not key:
        parser.error("Set SENSO_API_KEY in backend/.env")
    # .env.* is gitignored. Separate checkpoints for different API keys.
    state_path = BACKEND / f".env.senso-ingest-{hashlib.sha256(key.encode()).hexdigest()[:12]}.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    try:
        with httpx.Client(base_url=BASE_URL, headers={"X-API-Key": key}, timeout=30) as client:
            response = client.get("/org/me")
            response.raise_for_status()
            (spike if args.spike else seed)(client, state, state_path)
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"Senso HTTP {exc.response.status_code}; check key permissions/credits (402 = out of credits).\n")
    except RuntimeError as exc:
        parser.exit(1, f"{exc}\n")
    except httpx.RequestError:
        parser.exit(1, "Senso connection failed; rerun to resume pending uploads.\n")


if __name__ == "__main__":
    main()
