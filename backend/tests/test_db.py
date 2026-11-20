"""Storage regressions shared by the SQLite and SingleStore runs."""
import os
from pathlib import Path
import runpy
import sqlite3

import pymysql
import pytest
from dotenv import load_dotenv

from app import db
from app.seed import reset_and_seed


@pytest.fixture
def seeded():
    reset_and_seed()


def test_failed_transaction_rolls_back_all_writes(seeded):
    with pytest.raises(RuntimeError, match="abort"):
        with db.connect() as conn:
            conn.execute("UPDATE stores SET flagged = 1 WHERE id = 'bestbuy'")
            conn.execute("UPDATE users SET verified = 1 WHERE id = 'u_demo'")
            raise RuntimeError("abort")
    with db.connect() as conn:
        assert conn.execute("SELECT flagged FROM stores WHERE id = 'bestbuy'").fetchone()[0] == 0
        assert conn.execute("SELECT verified FROM users WHERE id = 'u_demo'").fetchone()[0] == 0


@pytest.mark.parametrize("id,decision_id", [("pur_one", "dec_two"), ("pur_two", "dec_one")])
def test_purchases_enforces_both_unique_keys(seeded, id, decision_id):
    sql = ("INSERT INTO purchases (id, request_id, user_id, listing_id, amount, status, decision_id, created_at)"
           " VALUES (?, 'r_unique', 'u_demo', 'l_bestbuy', 249, 'placed', ?, '2026-11-20')")
    with db.connect() as conn:
        conn.execute(sql, ("pur_one", "dec_one"))
    with pytest.raises((sqlite3.IntegrityError, pymysql.IntegrityError)):
        with db.connect() as conn:
            conn.execute(sql, (id, decision_id))
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM purchases").fetchone()[0] == 1


def test_sql_literals_and_bound_values_round_trip(seeded):
    with db.connect() as conn:
        cursor = conn.execute("SELECT '100% safe', ?", ("50% ? café 🎧",))
        assert cursor.fetchone() == ("100% safe", "50% ? café 🎧")


def test_mysql_url_decodes_credentials():
    options = db.mysql_options("mysql://user%40name:p%40ss%3A%2F%25@localhost:3307/shop_drill")
    assert options == {"host": "localhost", "port": 3307, "user": "user@name",
                       "password": "p@ss:/%", "database": "shop_drill"}


def test_failed_mysql_connection_does_not_fall_back_to_sqlite(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "mysql://u:p@localhost/shop_test")
    def fail(**kwargs):
        from pymysql.constants import CLIENT
        assert kwargs["client_flag"] & CLIENT.FOUND_ROWS
        assert kwargs["autocommit"] is False
        assert kwargs["ssl_verify_cert"] and kwargs["ssl_verify_identity"]
        raise pymysql.OperationalError("connection refused")
    monkeypatch.setattr(pymysql, "connect", fail)
    with pytest.raises(pymysql.OperationalError, match="connection refused"):
        with db.connect():
            pytest.fail("must not silently use SQLite")


@pytest.mark.parametrize("name", ["shop_demo", "shop_demo?db=shop_drill", "shop_demo%2Fshop_test"])
def test_test_guard_refuses_unsafe_databases(monkeypatch, name):
    monkeypatch.setenv("TEST_DATABASE_URL", f"mysql://u:p@localhost/{name}")
    monkeypatch.setenv("DATABASE_URL", "untouched")
    with pytest.raises(pytest.UsageError, match="_drill or _test"):
        runpy.run_path(str(Path(__file__).with_name("conftest.py")))
    assert os.environ["DATABASE_URL"] == "untouched"


@pytest.mark.parametrize("test_url", ["", "mysql://u:p@localhost/shop_drill", "mysql://u:p@localhost/shop_test"])
def test_test_guard_precedes_dotenv_and_disables_extras(monkeypatch, tmp_path, test_url):
    monkeypatch.setenv("TEST_DATABASE_URL", test_url)
    for key in ("DATABASE_URL", "SENSO_API_KEY", "COGNEE_ENABLED"):
        monkeypatch.setenv(key, "presenter-value")
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=mysql://u:p@localhost/shop_demo\nSENSO_API_KEY=live\nCOGNEE_ENABLED=1\n")
    runpy.run_path(str(Path(__file__).with_name("conftest.py")))
    load_dotenv(env_file)  # same non-overriding behavior as app.main
    assert os.environ["DATABASE_URL"] == test_url
    assert os.environ["SENSO_API_KEY"] == os.environ["COGNEE_ENABLED"] == ""


def test_shared_tier_schema_keys_purchases_on_decision_id():
    from app import db as _db
    s = _db.shared_tier_schema(_db.SCHEMA.read_text())
    block = s[s.index("CREATE TABLE IF NOT EXISTS purchases ("):]
    block = block[:block.index(");")]
    assert "ROWSTORE REFERENCE" not in block
    assert "decision_id VARCHAR(64) NOT NULL PRIMARY KEY" in block
    assert "id VARCHAR(64) PRIMARY KEY" not in block and "KEY (id)" in block


def test_shared_tier_schema_skips_senso_docs_to_stay_under_table_limit():
    from app import db as _db
    s = _db.shared_tier_schema(_db.SCHEMA.read_text())
    assert "senso_docs" not in s
    assert s.count("CREATE TABLE IF NOT EXISTS") <= 10
