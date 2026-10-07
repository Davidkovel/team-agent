"""Schema upgrades without Alembic.

Additive only: missing tables and missing columns are created, nothing is ever dropped, renamed or rewritten. That makes
it safe to run on every start, and on a database that is already current it does nothing. Before an existing SQLite
database is changed, a copy is made next to it (hub.db.bak-<date>); if the copy cannot be made, nothing is changed.
"""
import logging
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from sqlalchemy import inspect, text

from . import models  # noqa: F401  (the tables are known to Base only once the models are loaded)
from .db import Base

log = logging.getLogger("team.backend")

# 1: the first release (it had no version table).
# 2: projects, agent sessions, subagents, notifications, memory, expenses, AI requests; more fields on tasks and approvals.
# 3: the task bin (trashed_at, trash_reason and what to restore on tasks).
# 4: notifications say whether they were sent to that person (directed), for the widget's sound.
# 5: sync_log and sync_meta, for the Hubs of the team's computers to trade changes (sync.py).
# 6: users.phone_topic, for notifications on the phone (push.py).
# 12: tasks.doing_since, the "Estou a fazer" button.
# 13: tasks.crew, the member of the crew (crew.py) a task is given to.
SCHEMA_VERSION = 13


def current_version(conn) -> int:
    """0 = empty database, 1 = a database from before versions were written down."""
    tables = set(inspect(conn).get_table_names())
    if "schema_version" in tables:
        return conn.execute(text("SELECT MAX(version) FROM schema_version")).scalar() or 1
    return 1 if "users" in tables else 0


def _add_column(table: str, column, dialect) -> str:
    sql = f"ALTER TABLE {table} ADD COLUMN {column.name} {column.type.compile(dialect)}"
    default = column.default.arg if column.default is not None and column.default.is_scalar else None
    if isinstance(default, bool):
        default = int(default)
    if isinstance(default, str):
        sql += " DEFAULT '" + default.replace("'", "''") + "'"
    elif default is not None:
        sql += f" DEFAULT {default}"
    return sql  # always nullable: rows that already exist get the default, or NULL


def pending(conn) -> tuple[list[str], list[str]]:
    """(tables to create, ALTER statements to run) to bring this database to what models.py describes."""
    inspector = inspect(conn)
    existing = set(inspector.get_table_names())
    tables, columns = [], []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing:
            tables.append(table.name)
            continue
        have = {c["name"] for c in inspector.get_columns(table.name)}
        columns += [_add_column(table.name, c, conn.dialect) for c in table.columns if c.name not in have]
    return tables, columns


def apply(conn):
    version = current_version(conn)
    _, columns = pending(conn)
    Base.metadata.create_all(conn)  # only creates what is missing
    for statement in columns:
        conn.execute(text(statement))
    conn.execute(text("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at VARCHAR(40))"))
    if version < SCHEMA_VERSION or conn.execute(text("SELECT COUNT(*) FROM schema_version")).scalar() == 0:
        conn.execute(text("INSERT INTO schema_version (version, applied_at) VALUES (:v, :at)"),
                     {"v": SCHEMA_VERSION, "at": time.strftime("%Y-%m-%dT%H:%M:%S")})


def backup_sqlite(url) -> Path | None:
    """A consistent copy of the SQLite file (also while it is in use). None when there is no file to copy."""
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None
    source = Path(url.database)
    if not source.is_file():
        return None
    target = source.with_name(f"{source.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    with closing(sqlite3.connect(source)) as src, closing(sqlite3.connect(target)) as dst:
        src.backup(dst)
    return target


async def upgrade(engine):
    async with engine.connect() as conn:
        version = await conn.run_sync(current_version)
        tables, columns = await conn.run_sync(pending)
    if version and (tables or columns):  # an existing database is about to change: keep a copy first
        copy = backup_sqlite(engine.url)
        log.warning("Database upgrade v%s -> v%s: %s new tables, %s new columns. Backup: %s",
                    version, SCHEMA_VERSION, len(tables), len(columns), copy or "not made (not a SQLite file)")
    async with engine.begin() as conn:
        await conn.run_sync(apply)
