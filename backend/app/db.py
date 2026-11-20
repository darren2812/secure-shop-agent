"""Transactional storage: DATABASE_URL selects SingleStore; empty selects SQLite."""
from __future__ import annotations

import os
import sqlite3
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


class MySQLConnection:
    """Small SQLite-compatible execute surface over a tuple-returning MySQL client."""

    def __init__(self, connection):
        self.connection = connection
        self.cursors = []

    def execute(self, sql, params=()):
        cursor = self.connection.cursor()
        self.cursors.append(cursor)
        # Current application SQL has no literal question marks. Escape literal
        # percent signs because PyMySQL interpolates parameters using Python's %.
        cursor.execute(sql.replace("%", "%%").replace("?", "%s"), params)
        return cursor

    def close(self):
        try:
            for cursor in self.cursors:
                cursor.close()
        finally:
            self.connection.close()


def insert_ignore() -> str:
    return "INSERT IGNORE" if os.environ.get("DATABASE_URL") else "INSERT OR IGNORE"


def db_path() -> str:
    return os.environ.get("SQLITE_PATH", str(Path(__file__).resolve().parent.parent / "local.db"))


@contextmanager
def connect():
    url = os.environ.get("DATABASE_URL", "")
    if url:
        import pymysql
        from pymysql.constants import CLIENT

        raw = pymysql.connect(
            **mysql_options(url), charset="utf8mb4", client_flag=CLIENT.FOUND_ROWS,
            autocommit=False, connect_timeout=10, read_timeout=30, write_timeout=30,
            ssl_verify_cert=True, ssl_verify_identity=True,
        )
        conn = MySQLConnection(raw)
    else:
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
            # Schema statements contain no semicolons inside strings or comments.
            for statement in schema.split(";"):
                if statement.strip():
                    conn.execute(statement)
        else:
            conn.executescript(schema.replace("ROWSTORE REFERENCE ", ""))
