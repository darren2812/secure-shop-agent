"""Select storage before app.main can load the presenter's backend/.env."""
import os
from urllib.parse import unquote, urlsplit

import pytest


def configure_test_environment():
    url = os.environ.get("TEST_DATABASE_URL", "")
    if url:
        try:
            parsed = urlsplit(url)
            database = unquote(parsed.path.removeprefix("/"))
            valid = (parsed.scheme == "mysql" and parsed.hostname and parsed.username
                     and (parsed.port is None or parsed.port > 0)
                     and "/" not in database and not parsed.query and not parsed.fragment
                     and database.endswith(("_drill", "_test")))
        except ValueError:
            valid = False
        if not valid:
            raise pytest.UsageError("TEST_DATABASE_URL must name a MySQL database ending in _drill or _test")
    os.environ["DATABASE_URL"] = url
    os.environ["SENSO_API_KEY"] = ""
    os.environ["COGNEE_ENABLED"] = ""


configure_test_environment()
