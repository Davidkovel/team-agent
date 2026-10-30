"""Mensagens: the team writes to each other inside the Hub and the widget (21 Oct, Marco: «quando quiser passar contas,
comandos e tal, o pop-up abre; consigo mandar como se fossem mensagens lá no widget»).

A conversation is with one person (`peer` = their user id) or with the whole team (`peer` = "team"). Each message is one
row in `messages`, which sync carries to every PC; only the people in a conversation are shown it. Sending also writes a
`message` notification for whoever receives it: that is what lights the bell, opens the card on any page of the Hub
(shell.js) and the card of the widget (routers/local.py, /notices), and reaches the AMG app on the phone (web push, which is
end-to-end encrypted). ntfy is plain text on someone else's server, so it gets only who wrote, never what.
"""
import base64
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import push
from ..db import get_db
from ..models import Message, MessageSeen, Notification, User
from ..realtime import rt
from ..security import current_user, user_from_jwt
from ..services import iso

router = APIRouter(prefix="/api/messages")
PAGE = 300           # the newest messages of a conversation that are sent to the page
PREVIEW = 160        # how much of a message goes into the notification
IMAGE_MAX = 2_500_000   # the photo as a data URL; the page makes it small first (≤ 1600 px, JPEG)
IMAGE = re.compile(r"data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)")


def aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _in(user_id: int, peer: str):
    """The messages of `user_id`'s conversation with `peer`."""
    if peer == "team":
        return Message.to_user_id.is_(None)
    other = int(peer)
    return or_(and_(Message.sender_id == user_id, Message.to_user_id == other),
               and_(Message.sender_id == other, Message.to_user_id == user_id))


def _peer_for(m: Message, user_id: int) -> str:
    if m.to_user_id is None:
        return "team"
    return str(m.to_user_id if m.sender_id == user_id else m.sender_id)


async def _people(db: AsyncSession) -> list[User]:
    return list((await db.execute(select(User).order_by(User.id))).scalars())


async def _check_peer(db: AsyncSession, user: User, peer: str) -> str:
    if peer == "team":
        return peer
    if not peer.isdigit() or int(peer) == user.id or not await db.get(User, int(peer)):
        raise HTTPException(404, "Essa conversa não existe.")
    return peer


def out(m: Message, names: dict[int, str]) -> dict:
    return {"id": m.id, "from": m.sender_id, "from_name": names.get(m.sender_id, "?"), "to": m.to_user_id, "body": m.body,
            "image": bool(m.image), "at": iso(m.created_at)}


@router.get("")
async def conversations(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The conversations of this person: the team, then each other person, with the last message and how many are unread."""
    people = await _people(db)
    names = {u.id: u.display_name for u in people}
    seen = {s.peer: aware(s.seen_at) for s in (await db.execute(select(MessageSeen).where(MessageSeen.user_id == user.id))).scalars()}
    rows = []
    for peer, name, username in [("team", "Equipa", "")] + [(str(u.id), u.display_name, u.username) for u in people if u.id != user.id]:
        last = (await db.execute(select(Message).where(_in(user.id, peer)).order_by(Message.created_at.desc()).limit(1))).scalar()
        unread_q = select(func.count(Message.id)).where(_in(user.id, peer), Message.sender_id != user.id)
        if seen.get(peer):
            unread_q = unread_q.where(Message.created_at > seen[peer])
        rows.append({"peer": peer, "name": name, "username": username, "last": out(last, names) if last else None,
                     "unread": (await db.execute(unread_q)).scalar() or 0})
    return {"me": user.id, "conversations": rows, "unread": sum(r["unread"] for r in rows)}


@router.get("/{peer}")
async def thread(peer: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """A conversation, oldest first. Opening it reads it: up to now, and its notifications."""
    peer = await _check_peer(db, user, peer)
    names = {u.id: u.display_name for u in await _people(db)}
    found = list((await db.execute(select(Message).where(_in(user.id, peer)).order_by(Message.created_at.desc()).limit(PAGE))).scalars())
    now = datetime.now(timezone.utc)
    mark = await db.get(MessageSeen, (user.id, peer))
    if mark:
        mark.seen_at = now
    else:
        db.add(MessageSeen(user_id=user.id, peer=peer, seen_at=now))
    opened = False
    for n in (await db.execute(select(Notification).where(Notification.user_id == user.id, Notification.kind == "message",
                                                         Notification.href == f"#/mensagens/{peer}", Notification.read_at.is_(None)))).scalars():
        n.read_at, opened = now, True
    await db.commit()
    if opened:
        await rt.publish("notification", user.id)
    return {"peer": peer, "messages": [out(m, names) for m in reversed(found)]}


class MessageIn(BaseModel):
    body: str = Field("", max_length=8000)
    image: str | None = Field(None, max_length=IMAGE_MAX)


@router.get("/img/{message_id}")
async def image(message_id: int, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """A message's photo; the token goes in the address because it is an <img>. Only for the people in its conversation."""
    user = await user_from_jwt(token, db)
    if not user:
        raise HTTPException(401, "Invalid token")
    m = await db.get(Message, message_id)
    if not m or not m.image or not (m.to_user_id is None or user.id in (m.sender_id, m.to_user_id)):
        raise HTTPException(404, "Essa foto não existe.")
    found = IMAGE.fullmatch(m.image)
    if not found:
        raise HTTPException(404, "Essa foto não existe.")
    return Response(base64.b64decode(found.group(2)), media_type=f"image/{found.group(1)}",
                    headers={"Cache-Control": "private, max-age=604800"})


@router.post("/{peer}")
async def send(peer: str, body: MessageIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    peer = await _check_peer(db, user, peer)
    text = body.body.strip("\n")
    if body.image and not IMAGE.fullmatch(body.image):
        raise HTTPException(400, "Essa foto não se consegue abrir.")
    if not text.strip() and not body.image:
        raise HTTPException(400, "A mensagem está vazia.")
    m = Message(sender_id=user.id, to_user_id=None if peer == "team" else int(peer), body=text, image=body.image or None)
    db.add(m)
    people = await _people(db)
    targets = [u.id for u in people if u.id != user.id] if peer == "team" else [int(peer)]
    # the conversation as the person who receives it sees it: with the sender, or the team's
    href = "#/mensagens/team" if peer == "team" else f"#/mensagens/{user.id}"
    preview = " ".join(text.split()) or "📷 Foto"
    preview = preview if len(preview) <= PREVIEW else preview[:PREVIEW - 1].rsplit(" ", 1)[0] + "…"
    title = f"{user.display_name} na Equipa" if peer == "team" else f"Mensagem de {user.display_name}"
    for t in targets:
        db.add(Notification(user_id=t, kind="message", severity="high", title=title, body=preview, href=href, directed=True))
    mark = await db.get(MessageSeen, (user.id, peer))   # what I write, I have read
    if mark:
        mark.seen_at = datetime.now(timezone.utc)
    else:
        db.add(MessageSeen(user_id=user.id, peer=peer))
    await db.commit()
    await db.refresh(m)
    for t in targets + [user.id]:
        await rt.publish("notification", t)
    await rt.publish("message", user.id, "team")   # the conversation open on another page updates at once
    # on the phone it reads like iMessage: who wrote (and where) on top, what they wrote under it
    await push.to_people(db, targets, user.display_name, preview if peer != "team" else f"Equipa · {preview}", "high", href, "message")
    return out(m, {u.id: u.display_name for u in people})


@router.delete("/msg/{message_id}")
async def remove(message_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Take back one of my own messages (it also leaves the other PCs at the next sync)."""
    m = await db.get(Message, message_id)
    if not m or m.sender_id != user.id:
        raise HTTPException(404, "Essa mensagem não é tua.")
    await db.delete(m)   # through the session, so sync notes the delete and the other PCs drop it too
    await db.commit()
    await rt.publish("notification", user.id)
    return {"ok": True}
