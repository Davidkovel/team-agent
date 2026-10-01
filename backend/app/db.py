from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

if engine.dialect.name == "sqlite":
    # The dev/test database (the widget starts the Hub on SQLite). SQLite does not wait when two transactions that read
    # first and write later overlap (a login at the same moment as a presence update): it fails with "database is locked".
    # Taking the write lock up front makes them queue behind each other instead. PostgreSQL does not need any of this.
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_connect(dbapi_connection, record):
        dbapi_connection.isolation_level = None  # we send BEGIN ourselves
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout=15000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    @event.listens_for(engine.sync_engine, "begin")
    def _sqlite_begin(conn):
        conn.exec_driver_sql("BEGIN IMMEDIATE")


class Base(DeclarativeBase):
    pass


async def get_db():
    async with SessionLocal() as session:
        yield session
