"""Large sync uploads must make progress without dropping rows or leaking private conversations."""
import json

import pytest
from sqlalchemy import create_engine, insert

from app import models, sync
from app.db import Base


@pytest.fixture
def conn(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(sync, "CHUNK_BYTES", 1000)
    with engine.begin() as connection:
        yield connection
    engine.dispose()


def memory(conn, pk, content):
    conn.execute(insert(models.Memory).values(id=pk, scope="team", title="Nota", content=content))
    conn.execute(insert(sync.LOG).values(seq=pk, tbl="memory", pk=json.dumps([pk]), mt=pk, node=0, deleted=False))


def test_large_rows_arrive_in_separate_rounds_without_skipping(conn):
    for pk in range(1, 4):
        memory(conn, pk, "a" * 700)
    cursor, received = 0, []
    for _ in range(3):
        rows, cursor, more = sync._changes(conn, cursor)
        received.extend(row["row"]["id"] for row in rows)
    assert received == [1, 2, 3]
    assert cursor == 3 and not more


def test_one_row_bigger_than_the_budget_does_not_stall_sync(conn):
    memory(conn, 1, "a" * 2000)
    memory(conn, 2, "small")
    rows, cursor, more = sync._changes(conn, 0)
    assert [row["row"]["id"] for row in rows] == [1]
    assert cursor == 1 and more
    rows, cursor, more = sync._changes(conn, cursor)
    assert [row["row"]["id"] for row in rows] == [2]
    assert cursor == 2 and not more


def test_private_rows_advance_the_cursor_without_being_shared(conn):
    memory(conn, 1, "a" * 700)
    conn.execute(insert(models.Task).values(id=2, title="Private", assignee_id=1, created_by=1, agent_role="conversa"))
    conn.execute(insert(sync.LOG).values(seq=2, tbl="tasks", pk="[2]", mt=2, node=0, deleted=False))
    memory(conn, 3, "a" * 700)
    rows, cursor, more = sync._changes(conn, 0)
    assert [row["row"]["id"] for row in rows] == [1]
    assert cursor == 2 and more
    rows, cursor, more = sync._changes(conn, cursor)
    assert [row["row"]["id"] for row in rows] == [3]
    assert cursor == 3 and not more
