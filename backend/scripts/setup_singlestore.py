"""Provision S0 databases from the gitignored root .env.singlestore.

Run from backend: .venv/bin/python scripts/setup_singlestore.py --configure
Use --test to run the suite on shop_drill without printing a credential-bearing URL.
Existing seeded databases are preserved. Tests reset shop_drill, never shop_demo.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote

from dotenv import dotenv_values, set_key

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app import db  # noqa: E402
from app.seed import reset_and_seed  # noqa: E402


def database_url(settings: dict, database: str) -> str:
    host = settings["SINGLESTORE_HOST"]
    if ":" in host:  # IPv6 URLs need brackets.
        host = f"[{host}]"
    return (f"mysql://{quote(settings['SINGLESTORE_USER'], safe='')}:"
            f"{quote(settings['SINGLESTORE_PASSWORD'], safe='')}@"
            f"{host}:{settings.get('SINGLESTORE_PORT') or '3306'}/{database}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--configure", action="store_true", help="Set backend/.env DATABASE_URL to shop_demo")
    parser.add_argument("--test", action="store_true", help="Run pytest against shop_drill (resets drill data)")
    args = parser.parse_args()
    settings = {**dotenv_values(BACKEND.parent / ".env.singlestore"), **os.environ}
    required = ("SINGLESTORE_HOST", "SINGLESTORE_USER", "SINGLESTORE_PASSWORD")
    if any(not settings.get(key) for key in required):
        parser.error("Set SINGLESTORE_HOST, SINGLESTORE_USER and SINGLESTORE_PASSWORD in .env.singlestore")

    # Connect to the existing database only to issue additive CREATE DATABASEs.
    existing = settings.get("SINGLESTORE_DATABASE") or "information_schema"
    os.environ["DATABASE_URL"] = database_url(settings, existing)
    with db.connect() as conn:
        for name in ("shop_demo", "shop_drill"):
            conn.execute(f"CREATE DATABASE IF NOT EXISTS {name}")

    for name in ("shop_demo", "shop_drill"):
        os.environ["DATABASE_URL"] = database_url(settings, name)
        db.init_db()
        with db.connect() as conn:
            seeded = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        if not seeded:
            reset_and_seed()
        print(f"{name}: schema ready ({'existing seed preserved' if seeded else 'seeded'})")

    if args.configure:
        env_path = BACKEND / ".env"
        if not env_path.exists():
            env_path.touch(mode=0o600)
        set_key(str(env_path), "DATABASE_URL", database_url(settings, "shop_demo"))
        print("backend/.env configured for shop_demo")

    if args.test:
        env = {**os.environ, "TEST_DATABASE_URL": database_url(settings, "shop_drill")}
        sys.exit(subprocess.call([sys.executable, "-m", "pytest", "-q", "tests"], cwd=BACKEND, env=env))


if __name__ == "__main__":
    main()
