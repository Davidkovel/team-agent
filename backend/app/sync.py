"""Hub-to-Hub sync: there is no host. Every computer runs its own Hub on its own copy of the database, and the copies
trade what changed whenever two of them are on at the same time (over the team's VPN).

How it works, in three rules:
- Every row written here is noted in `sync_log` (table, primary key, when, by which computer). A deleted row stays noted.
- Two Hubs exchange the notes the other has not seen yet, with the rows. The newest change to a row wins.
- New rows get ids no other computer can produce (time * 4 + the computer's number), so they still sort by age.

The owner's computer holds the team's database (`origin`); a copy that never met it takes it whole the first time
they meet, dropping what it had. Off unless SYNC=1 (the widget sets it for the Hub it starts).
"""
import asyncio
import hmac
import json
import logging
import secrets
import socket
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import BigInteger, DateTime, String, UniqueConstraint, and_, cast, delete, event, func, insert, literal, null, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .config import settings
from .db import Base, SessionLocal, engine
from .realtime import rt

log = logging.getLogger("team.sync")

ID_EPOCH = datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp()
UNKNOWN_NODE = 3  # a computer whose VPN address is not one of the team's
CHUNK = 1000

ACTIVE = False
NODE = UNKNOWN_NODE
_last_id: dict[str, int] = {}
_last_mt = 0


class SyncLog(Base):
    """The last change to each row: `seq` is the order things arrived at this computer, `mt` decides who wins."""
    __tablename__ = "sync_log"
    __table_args__ = (UniqueConstraint("tbl", "pk"), {"sqlite_autoincrement": True})  # a seq is never handed out twice
    seq: Mapped[int] = mapped_column(primary_key=True)
    tbl: Mapped[str] = mapped_column(String(60))
    pk: Mapped[str] = mapped_column(String(200))  # JSON list of the primary key values
    mt: Mapped[int] = mapped_column(BigInteger)  # milliseconds
    node: Mapped[int] = mapped_column()
    deleted: Mapped[bool] = mapped_column(default=False)


class SyncMeta(Base):
    __tablename__ = "sync_meta"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(400))


LOG, META = SyncLog.__table__, SyncMeta.__table__
OWN = ("sync_log", "sync_meta", "schema_version")


def _tables():
    return [t for t in Base.metadata.sorted_tables if t.name not in OWN]


# ------------------------------------------------------------------ who this computer is

def team_ips() -> list[tuple[str, str]]:
    """[(VPN address, login)] in the team's order: the position is the computer's number."""
    return [tuple(x.strip() for x in p.split("=", 1)) for p in settings.team_ip_users.split(",") if "=" in p]


def local_ips() -> set[str]:
    try:
        return set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        return set()


def whoami() -> tuple[int, str] | None:
    """(number, login) of the person whose computer this is, by its VPN address; None when the VPN is not up."""
    mine = local_ips()
    return next(((i, login) for i, (ip, login) in enumerate(team_ips()) if ip in mine), None)


def peers() -> list[str]:
    if settings.sync_peers:
        return [p.strip() for p in settings.sync_peers.split(",") if p.strip()]
    mine = local_ips()
    return [ip for ip, _ in team_ips() if ip not in mine]


# ------------------------------------------------------------------ noting what changes here

def _now_mt() -> int:
    global _last_mt
    _last_mt = max(int(time.time() * 1000), _last_mt + 1)  # always later than anything seen, even with a slow clock
    return _last_mt


def _stamp(conn, tbl: str, pk: str, mt: int, node: int, deleted: bool):
    conn.execute(delete(LOG).where(LOG.c.tbl == tbl, LOG.c.pk == pk))
    conn.execute(insert(LOG).values(tbl=tbl, pk=pk, mt=mt, node=node, deleted=deleted))


@event.listens_for(Base, "before_insert", propagate=True)
def _assign_id(mapper, connection, target):
    table = mapper.local_table
    if not ACTIVE or table.name in OWN or [c.name for c in table.primary_key.columns] != ["id"] or target.id is not None:
        return
    fresh = int((time.time() - ID_EPOCH) * 10) * 4 + NODE
    target.id = _last_id[table.name] = max(fresh, _last_id.get(table.name, 0) + 4)


@event.listens_for(Session, "after_flush")
def _note_flush(session, context):
    if not ACTIVE:
        return
    changed = [(o, False) for o in session.new] + [(o, False) for o in session.dirty if session.is_modified(o)]
    changed += [(o, True) for o in session.deleted]
    conn = None
    for obj, gone in changed:
        table = getattr(obj, "__table__", None)
        if table is None or table.name in OWN:
            continue
        conn = conn or session.connection()
        pk = json.dumps(list(obj.__mapper__.primary_key_from_instance(obj)))
        _stamp(conn, table.name, pk, _now_mt(), NODE, gone)


async def note(db, model, ids, deleted: bool = False):
    """For the few places that change rows with a plain UPDATE/DELETE, which the session does not see."""
    if ACTIVE and ids:
        await db.run_sync(lambda s: [_stamp(s.connection(), model.__tablename__, json.dumps([i]), _now_mt(), NODE, deleted) for i in ids])


# ------------------------------------------------------------------ reading and applying changes

def _get(conn, key: str) -> str | None:
    return conn.execute(select(META.c.value).where(META.c.key == key)).scalar()


def _set(conn, key: str, value: str):
    conn.execute(delete(META).where(META.c.key == key))
    conn.execute(insert(META).values(key=key, value=value))


def _pk_where(table, pk: str):
    return and_(*(col == value for col, value in zip(table.primary_key.columns, json.loads(pk))))


def _changes(conn, since: int) -> tuple[list[dict], int, bool]:
    """(what changed here after `since`, the new cursor, whether there is more)."""
    entries = conn.execute(select(LOG).where(LOG.c.seq > since).order_by(LOG.c.seq).limit(CHUNK)).all()
    out = []
    for e in entries:
        item = {"tbl": e.tbl, "pk": e.pk, "mt": e.mt, "node": e.node, "deleted": bool(e.deleted)}
        table = Base.metadata.tables.get(e.tbl)
        row = None if table is None or e.deleted else conn.execute(select(table).where(_pk_where(table, e.pk))).first()
        if row is None:
            item["deleted"] = True
        else:
            item["row"] = {k: v.isoformat() if isinstance(v, datetime) else v for k, v in row._mapping.items()}
        out.append(item)
    return out, (entries[-1].seq if entries else since), len(entries) == CHUNK


def _uniques(table):
    return [list(c.columns) for c in table.constraints if isinstance(c, UniqueConstraint)] + [[c] for c in table.columns if c.unique]


def _apply(conn, changes: list[dict]) -> int:
    global _last_mt
    done = 0
    for c in changes:
        table = Base.metadata.tables.get(c["tbl"])
        if table is None or table.name in OWN:
            continue  # a table from a newer version of the Hub
        _last_mt = max(_last_mt, c["mt"])
        have = conn.execute(select(LOG.c.mt, LOG.c.node).where(LOG.c.tbl == c["tbl"], LOG.c.pk == c["pk"])).first()
        if have and (have.mt, have.node) >= (c["mt"], c["node"]):
            continue  # what is here is as new or newer
        conn.execute(delete(table).where(_pk_where(table, c["pk"])))
        if not c["deleted"]:
            values = {}
            for col in table.columns:
                v = c["row"].get(col.name)
                # null(): a JSON column would otherwise store the text 'null' instead of nothing
                values[col.name] = null() if v is None else datetime.fromisoformat(v) if isinstance(col.type, DateTime) else v
            for cols in _uniques(table):  # the same thing made on two computers (a project name, a clock-in): the newer stays
                if all(c["row"].get(k.name) is not None for k in cols):
                    same = and_(*(k == values[k.name] for k in cols))
                    for old in conn.execute(select(*table.primary_key.columns).where(same)).all():
                        old_pk = json.dumps(list(old))
                        conn.execute(delete(table).where(_pk_where(table, old_pk)))
                        _stamp(conn, table.name, old_pk, c["mt"], c["node"], True)
            conn.execute(insert(table).values(**values))
        _stamp(conn, c["tbl"], c["pk"], c["mt"], c["node"], c["deleted"])
        done += 1
    return done


def _adopt(conn, origin: str):
    """This copy never met the team's database: it takes it whole. What it had goes."""
    for table in _tables():
        conn.execute(delete(table))
    conn.execute(delete(LOG))
    conn.execute(delete(META).where(META.c.key.like("peer:%")))
    _set(conn, "origin", origin)
    _set(conn, "epoch", secrets.token_hex(8))
    log.warning("Joined the team's database %s: this copy starts again from the others", origin)


def _prepare(conn):
    if not _get(conn, "epoch"):
        _set(conn, "epoch", secrets.token_hex(8))  # names this copy: a peer that sees a new one starts the exchange over
    if not _get(conn, "origin") and NODE == 0:
        # the owner's computer was the host: its database is the team's, and everything in it is there to be handed out
        rows = [{"tbl": t.name, "pk": json.dumps(list(r)), "mt": 1, "node": 0, "deleted": False}
                for t in _tables() for r in conn.execute(select(*t.primary_key.columns)).all()]
        if rows:
            conn.execute(insert(LOG), rows)
        _set(conn, "origin", secrets.token_hex(8))
        log.warning("This is now the team's database: %s rows ready for the other computers", len(rows))


async def prepare():
    """Before anything is written: who this computer is, and the team's database if it lives here."""
    global ACTIVE, NODE
    me = whoami()
    NODE = settings.sync_node if settings.sync_node >= 0 else me[0] if me else UNKNOWN_NODE
    ACTIVE = True
    async with engine.begin() as conn:
        await conn.run_sync(_prepare)


# ------------------------------------------------------------------ the exchange

class Exchange(BaseModel):
    node: int
    origin: str | None
    epoch: str
    your_epoch: str | None  # the copy of the other side this one has been keeping count for
    since: int
    changes: list[dict]
    present: list[dict] = []  # who is online at the caller's computer (see _present)


def _answer(conn, body: Exchange) -> dict:
    origin, epoch = _get(conn, "origin"), _get(conn, "epoch")
    reply = {"node": NODE, "origin": origin, "epoch": epoch, "changes": [], "cursor": body.since, "more": False, "reset": False}
    if body.epoch == epoch:
        return reply  # talking to itself
    if not origin and body.origin:
        _adopt(conn, body.origin)
        return {**reply, "origin": body.origin, "epoch": _get(conn, "epoch"), "reset": True}
    if not origin or origin != body.origin:
        return reply  # the caller joins (or it is another team's database: nothing is exchanged)
    if body.your_epoch != epoch:
        return {**reply, "reset": True}
    reply["changes"], reply["cursor"], reply["more"] = _changes(conn, body.since)  # read first: no echo of what comes in now
    _apply(conn, body.changes)
    return reply


def _outgoing(conn, ip: str) -> tuple[dict, int, bool]:
    origin = _get(conn, "origin")
    peer = json.loads(_get(conn, f"peer:{ip}") or "{}")
    changes, upto, more = _changes(conn, peer.get("sent", 0)) if origin and peer.get("epoch") else ([], peer.get("sent", 0), False)
    return ({"node": NODE, "origin": origin, "epoch": _get(conn, "epoch"), "your_epoch": peer.get("epoch"),
             "since": peer.get("since", 0), "changes": changes}, upto, more)


def _incoming(conn, ip: str, upto: int, more: bool, reply: dict) -> bool:
    """True when another round should follow at once."""
    origin = _get(conn, "origin")
    fresh = json.dumps({"epoch": reply["epoch"], "since": 0, "sent": 0})
    if reply["epoch"] == _get(conn, "epoch"):
        return False
    if not origin and reply["origin"]:
        _adopt(conn, reply["origin"])
        _set(conn, f"peer:{ip}", fresh)
        return True
    if not origin or origin != reply["origin"]:
        return False
    if reply["reset"]:
        _set(conn, f"peer:{ip}", fresh)
        return True
    _apply(conn, reply["changes"])
    _set(conn, f"peer:{ip}", json.dumps({"epoch": reply["epoch"], "since": reply["cursor"], "sent": upto}))
    return more or reply["more"]


PRESENCE_TTL = 20  # a few exchanges: a computer that goes off stops being heard and its person goes offline here
HEARD: dict[int, float] = {}  # user id -> last time another computer said they were online there (for "visto há")


async def _present() -> list[dict]:
    """Who is online through this computer (its widget, Hub page or agent). What was heard from another computer is
    not passed on: each computer speaks only for its own people, so nobody stays online by echo."""
    async with SessionLocal() as db:
        ids = (await db.execute(select(Base.metadata.tables["users"].c.id))).scalars().all()
    found = [(i, await rt.store.get_presence(i)) for i in ids]
    return [{"user": i, "data": d} for i, d in found if d is not None and not d.get("remote")]


async def _hear(present: list[dict]):
    """Another computer says who is online there: they show online here too, for as long as it keeps saying so."""
    for p in present:
        HEARD[p["user"]] = time.time()
        current = await rt.store.get_presence(p["user"])
        if current is not None and not current.get("remote"):
            continue  # that person is at this computer: what is known here is better
        await rt.store.set_presence(p["user"], {**p["data"], "remote": True}, PRESENCE_TTL)
        if current is None or current.get("status") != p["data"].get("status"):
            await rt.publish("presence", p["user"], "team")


async def _round(client: httpx.AsyncClient, ip: str) -> bool:
    async with engine.begin() as conn:
        body, upto, more = await conn.run_sync(_outgoing, ip)
    body["present"] = await _present()
    res = await client.post(f"http://{ip if ':' in ip else f'{ip}:{settings.sync_port}'}/api/sync/exchange", json=body, headers={"X-Team-Key": settings.team_key})
    res.raise_for_status()
    reply = res.json()
    await _hear(reply.get("present", []))
    async with engine.begin() as conn:
        return await conn.run_sync(_incoming, ip, upto, more, reply)


async def loop():
    async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=3)) as client:
        while True:
            for ip in peers():
                try:
                    for _ in range(500):
                        if not await _round(client, ip):
                            break
                except (httpx.HTTPError, OSError):
                    pass  # that computer is off, or its Hub is from before this existed
                except Exception:
                    log.exception("Sync with %s failed", ip)
            await asyncio.sleep(settings.sync_seconds)


router = APIRouter(prefix="/api/sync")


@router.post("/exchange")
async def exchange(body: Exchange, request: Request):
    """Another computer of the team hands over what changed there and takes what changed here."""
    if not ACTIVE:
        raise HTTPException(404, "Sync is off")
    host = request.client.host if request.client else ""
    key = request.headers.get("x-team-key", "")
    if host not in [ip for ip, _ in team_ips()] and not (settings.team_key and hmac.compare_digest(key.encode(), settings.team_key.encode())):
        raise HTTPException(403, "Only the team's computers")
    async with engine.begin() as conn:
        reply = await conn.run_sync(_answer, body)
    if body.epoch != reply["epoch"]:
        await _hear(body.present)
    return {**reply, "present": await _present()}


async def notices(db, model, mine: tuple, after: int | None) -> tuple[int, list]:
    """(latest, [(seq, notification)]) by the order they reached this computer: one made while this computer was off
    arrives late with an old id, and still has to ring. Old or already read ones do not."""
    here = and_(LOG.c.tbl == model.__tablename__, LOG.c.pk == literal("[") + cast(model.id, String) + literal("]"))
    latest = (await db.execute(select(func.max(LOG.c.seq)).join(model, here).where(*mine))).scalar() or 0
    if after is None:
        return latest, []
    recent = datetime.now(timezone.utc) - timedelta(days=3)
    rows = await db.execute(select(LOG.c.seq, model).join(model, here)
                            .where(*mine, LOG.c.seq > after, model.read_at.is_(None), model.created_at >= recent).order_by(LOG.c.seq))
    return latest, [(seq, n) for seq, n in rows.all()]


@router.post("/limits")
async def refresh_limits(request: Request):
    """Another computer of the team asks this one to read its person's Claude windows again and write them for everybody."""
    if not ACTIVE:
        raise HTTPException(404, "Sync is off")
    host = request.client.host if request.client else ""
    key = request.headers.get("x-team-key", "")
    if host not in [ip for ip, _ in team_ips()] and not (settings.team_key and hmac.compare_digest(key.encode(), settings.team_key.encode())):
        raise HTTPException(403, "Only the team's computers")
    from . import limits   # here, not on top: limits imports this module
    return await limits.refresh_here()
