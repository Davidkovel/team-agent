"""29 out: the Mac reaches Marco and Kovel only through David's PC, so a presence heard is passed on once, and never echoes back."""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db")  # like the other tests: importing app reads it
os.environ.setdefault("REDIS_URL", "")

from app.sync import _pass_on  # noqa: E402


def test_own_people_go_one_hop():
    assert _pass_on({"status": "ONLINE", "via": "widget"}) == {"status": "ONLINE", "via": "widget", "hops": 1}


def test_heard_is_passed_on_once():
    heard = {"status": "ONLINE", "remote": True, "hops": 1}   # the PC heard David from the Mac
    assert _pass_on(heard) == {"status": "ONLINE", "hops": 2}  # and tells Marco


def test_passed_on_is_not_passed_again():
    assert _pass_on({"status": "ONLINE", "remote": True, "hops": 2}) is None  # Marco does not tell the PC back: no echo


def test_old_hubs_without_hops_count_as_one():
    assert _pass_on({"status": "ONLINE", "remote": True})["hops"] == 2
    assert _pass_on(None) is None
