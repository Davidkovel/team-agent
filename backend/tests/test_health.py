"""Saúde: the Hub finds the widget above it and the widget's web window below that, and measures what each costs."""
import os
import sys
import time

from test_office import client, login  # noqa: F401  (first: it points the app at a temporary database)

import pytest

from app import health


def test_the_parts_are_found_by_walking_the_process_tree():
    table = {10: (5, "pythonw.exe"), 5: (1, "explorer.exe"), 20: (10, "python.exe"), 30: (20, "python.exe"),
             40: (10, "qtwebengineprocess.exe"), 41: (40, "qtwebengineprocess.exe"), 99: (1, "qtwebengineprocess.exe")}
    assert health.parts(table, 30) == {"hub": [30, 20], "widget": [10], "web": [40, 41]}
    assert health.parts({30: (1, "python.exe")}, 30) == {"hub": [30], "widget": [], "web": []}  # a Hub started by hand


@pytest.mark.skipif(sys.platform != "win32", reason="Windows' own calls")
def test_this_process_is_measured_and_the_cpu_needs_two_looks():
    first = health.measure()
    assert first["hub_ram"] and first["hub_ram"] > 0 and first["hub_cpu"] is None
    end = time.monotonic() + 0.3
    while time.monotonic() < end:
        sum(range(10000))  # some work to see
    second = health.measure()
    assert second["hub_cpu"] is not None and second["hub_cpu"] > 0
    assert second["cores"] == (os.cpu_count() or 1)


def test_everybodys_pc_is_listed_even_before_it_was_measured(client):
    owner = login(client, "owner")
    body = client.get("/api/health", headers=owner).json()
    assert body["limits"] == {"widget": 1.0, "hub": 1.0, "web": 3.0}
    assert {p["user"] for p in body["pcs"]} >= {"owner", "mark", "david"}
    assert all(p["hub_cpu"] is None or isinstance(p["hub_cpu"], float) for p in body["pcs"])
