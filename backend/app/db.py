"""Transactional storage: DATABASE_URL selects SingleStore; empty selects SQLite."""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import unquote, urlsplit

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"


def mysql_options(url: str) -> dict:
    """Parse a mysql:// URL without including credentials in validation errors."""
    try:
        parsed = urlsplit(url)
        port = parsed.port or 3306
    except ValueError:
        raise ValueError("Invalid DATABASE_URL") from None
    database = unquote(parsed.path.removeprefix("/"))
    if (parsed.scheme != "mysql" or not parsed.hostname or not parsed.username
            or not database or "/" in database or parsed.query or parsed.fragment):
        raise ValueError("DATABASE_URL must be mysql://user:password@host:port/database")
    return {"host": parsed.hostname, "port": port, "user": unquote(parsed.username),
            "password": unquote(parsed.password or ""), "database": database}


_CACHEABLE = ("stores", "store_policies", "store_signals", "listings", "reference_prices")
_read_cache: dict = {}
_cache_lock = threading.Lock()


def clear_read_cache() -> None:
    with _cache_lock:
        _read_cache.clear()


class _CachedCursor:
    def __init__(self, description, rows):
        self.description, self._rows = description, rows

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def close(self):
        pass


class MySQLConnection:
    """Small SQLite-compatible execute surface over a tuple-returning MySQL client."""

    def __init__(self, connection):
        self.connection = connection
        self.cursors = []
        self.wrote = False
        self.touched_catalog = False

    def execute(self, sql, params=()):
        is_select = sql.lstrip()[:6].upper().startswith("SELECT")
        lowered = sql.lower()
        # Demo catalog tables are read many times per turn over a ~80 ms WAN link: cache reads,
        # and drop the cache on any write. Ledger, decisions, purchases, users and audit are never cached.
        cacheable = is_select and not any(t in lowered for t in ("audit_events", "decisions", "ledger", "purchases", "users")) \
            and any(t in lowered for t in _CACHEABLE)
        key = (sql, tuple(params) if params else ())
        if cacheable:
            with _cache_lock:
                hit = _read_cache.get(key)
            if hit is not None:
                return _CachedCursor(*hit)
        cursor = self.connection.cursor()
        self.cursors.append(cursor)
        if not is_select:
            self.wrote = True
            if any(t in lowered for t in _CACHEABLE) or "drop" in lowered or "create" in lowered:
                self.touched_catalog = True
                clear_read_cache()
        # Current application SQL has no literal question marks. Escape literal
        # percent signs because PyMySQL interpolates parameters using Python's %.
        cursor.execute(sql.replace("%", "%%").replace("?", "%s"), params)
        if cacheable:
            rows = cursor.fetchall()
            with _cache_lock:
                _read_cache[key] = (cursor.description, rows)
            return _CachedCursor(cursor.description, rows)
        return cursor

    def close(self):
        try:
            for cursor in self.cursors:
                cursor.close()
        finally:
            self.connection.close()


def insert_ignore() -> str:
    return "INSERT IGNORE" if os.environ.get("DATABASE_URL") else "INSERT OR IGNORE"


def shared_tier() -> bool:
    """SingleStore shared (free) tier: no reference tables, one unique key per sharded table."""
    return os.environ.get("SINGLESTORE_SHARED_TIER", "") == "1"


def shared_tier_schema(schema: str) -> str:
    """The shared tier allows 10 tables per database: skip the optional Senso mapping table
    (Senso then stays off instead of failing startup), and make purchases a sharded table keyed on decision_id (the single-use key that matters).
    purchases.id stays a server-generated uuid, indexed but not unique-enforced on this tier."""
    schema = ";".join(part for part in schema.split(";") if "senso_docs" not in part)
    schema = schema.replace("CREATE ROWSTORE REFERENCE TABLE IF NOT EXISTS purchases (",
                            "CREATE TABLE IF NOT EXISTS purchases (")
    start = schema.index("CREATE TABLE IF NOT EXISTS purchases (")
    end = schema.index(");", start)
    block = schema[start:end]
    block = block.replace("id VARCHAR(64) PRIMARY KEY,", "id VARCHAR(64) NOT NULL,", 1)
    block = block.replace("decision_id VARCHAR(64) NOT NULL UNIQUE,", "decision_id VARCHAR(64) NOT NULL PRIMARY KEY,", 1)
    return schema[:start] + block + "\n  , KEY (id)\n" + schema[end:]


def db_path() -> str:
    return os.environ.get("SQLITE_PATH", str(Path(__file__).resolve().parent.parent / "local.db"))


_local = threading.local()


def _idle_pool(url: str) -> list:
    """Per-thread idle connections for one DATABASE_URL (each thread owns its connections)."""
    pools = getattr(_local, "pools", None)
    if pools is None:
        pools = _local.pools = {}
    return pools.setdefault(url, [])


@contextmanager
def connect():
    url = os.environ.get("DATABASE_URL", "")
    if url:
        import pymysql
        from pymysql.constants import CLIENT

        idle = _idle_pool(url)
        raw = None
        while idle and raw is None:
            stamp, candidate = idle.pop()
            if time.monotonic() - stamp < 60:
                raw = candidate  # fresh enough: skip the ping round trip
                break
            try:
                candidate.ping(reconnect=True)
                raw = candidate
            except Exception:
                try:
                    candidate.close()
                except Exception:
                    pass
        if raw is None:
            raw = pymysql.connect(
                **mysql_options(url), charset="utf8mb4", client_flag=CLIENT.FOUND_ROWS,
                autocommit=False, connect_timeout=10, read_timeout=30, write_timeout=30,
                ssl_verify_cert=True, ssl_verify_identity=True,
            )
        conn = MySQLConnection(raw)
        ok = False
        try:
            yield conn
            if conn.wrote:
                raw.commit()
                if conn.touched_catalog:
                    clear_read_cache()
            # Read-only use: no commit round trip; SingleStore reads are READ COMMITTED per statement.
            ok = True
        except BaseException:
            raw.rollback()
            raise
        finally:
            for cursor in conn.cursors:
                try:
                    cursor.close()
                except Exception:
                    pass
            # Reuse the TLS connection (a new one costs ~0.8 s); nested connect() calls get their own.
            if ok and len(idle) < 4:
                idle.append((time.monotonic(), raw))
            else:
                try:
                    raw.close()
                except Exception:
                    pass
        return
    raw = conn = sqlite3.connect(db_path(), timeout=10)
    try:
        yield conn
        raw.commit()
    except BaseException:
        raw.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    schema = SCHEMA.read_text()
    with connect() as conn:
        if isinstance(conn, MySQLConnection):
            if shared_tier():
                schema = shared_tier_schema(schema)
            # Schema statements contain no semicolons inside strings or comments.
            for statement in schema.split(";"):
                if statement.strip():
                    conn.execute(statement)
        else:
            conn.executescript(schema.replace("ROWSTORE REFERENCE ", ""))
