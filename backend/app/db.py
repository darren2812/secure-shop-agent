"""Storage. Local SQLite by default so everyone can run and test offline.

SingleStore swap: set DATABASE_URL and replace connect() with a MySQL-protocol
client; schema.sql is written to work on both (placeholders differ: ? vs %s).
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"


def db_path() -> str:
    return os.environ.get("SQLITE_PATH", str(Path(__file__).resolve().parent.parent / "local.db"))


@contextmanager
def connect():
    conn = sqlite3.connect(db_path(), timeout=10)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA.read_text())
