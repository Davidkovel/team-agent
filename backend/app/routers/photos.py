"""Fotos da Ten Fold (30 Oct, Marco: «uma livraria, uma cena para fotos... a gente tem que organizar bem aquilo»).

The agency's photo library: anyone in the team adds photos, puts them in albums, renames, moves and deletes them. Each
photo is one row in `photos` (a JPEG data URL and a small thumb, both made in the browser), so sync carries it to every
PC like a message's photo. The list never carries the pictures: they come one by one from /api/photos/<id>/img.
"""
import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Photo, User
from ..realtime import rt
from ..security import current_user, user_from_jwt
from ..services import iso

router = APIRouter(prefix="/api/photos")
IMAGE_MAX = 3_500_000    # the photo as a data URL; the page makes it ≤ 2000 px JPEG first
THUMB_MAX = 300_000
IMAGE = re.compile(r"data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)")
DEFAULT_ALBUM = "Geral"


def _album(name: str | None) -> str:
    return " ".join((name or "").split())[:80] or DEFAULT_ALBUM


class PhotoIn(BaseModel):
    image: str = Field(..., max_length=IMAGE_MAX)
    thumb: str = Field(..., max_length=THUMB_MAX)
    album: str = Field("", max_length=200)
    title: str = Field("", max_length=400)
    company: str = Field("tenfold", max_length=40)


class PhotoEdit(BaseModel):
    album: str | None = Field(None, max_length=200)
    title: str | None = Field(None, max_length=400)


class AlbumEdit(BaseModel):
    name: str = Field(..., max_length=200)
    to: str = Field(..., max_length=200)
    company: str = Field("tenfold", max_length=40)


@router.get("")
async def list_photos(company: str = "tenfold", user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    people = {u.id: u.display_name for u in (await db.execute(select(User))).scalars()}
    rows = (await db.execute(select(Photo.id, Photo.album, Photo.title, Photo.user_id, Photo.created_at)
                             .where(Photo.company == company).order_by(Photo.created_at.desc()))).all()
    items = [{"id": r.id, "album": r.album, "title": r.title, "by": people.get(r.user_id or 0, ""),
              "mine": r.user_id == user.id, "created_at": iso(r.created_at)} for r in rows]
    albums: dict[str, dict] = {}
    for it in items:   # newest first, so the first photo seen is the album's cover
        a = albums.setdefault(it["album"], {"name": it["album"], "count": 0, "cover": it["id"], "updated_at": it["created_at"]})
        a["count"] += 1
    return {"items": items, "albums": sorted(albums.values(), key=lambda a: a["updated_at"] or "", reverse=True)}


@router.get("/{photo_id}/img")
async def image(photo_id: int, token: str = Query(...), size: str = "full", db: AsyncSession = Depends(get_db)):
    """The picture (or its thumb); the token goes in the address because it is an <img>."""
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    p = await db.get(Photo, photo_id)
    found = p and IMAGE.fullmatch((p.thumb if size == "thumb" and p.thumb else p.image) or "")
    if not found:
        raise HTTPException(404, "Essa foto não existe.")
    return Response(base64.b64decode(found.group(2)), media_type=f"image/{found.group(1)}",
                    headers={"Cache-Control": "private, max-age=604800"})


@router.post("")
async def add(body: PhotoIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not IMAGE.fullmatch(body.image) or not IMAGE.fullmatch(body.thumb):
        raise HTTPException(400, "Essa foto não se consegue abrir.")
    p = Photo(company=body.company[:40] or "tenfold", album=_album(body.album), title=body.title.strip()[:160],
              user_id=user.id, image=body.image, thumb=body.thumb)
    db.add(p)
    await db.commit()
    await rt.publish("photo", user.id, "team")
    return {"id": p.id, "album": p.album}


@router.patch("/{photo_id}")
async def edit(photo_id: int, body: PhotoEdit, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(Photo, photo_id)
    if not p:
        raise HTTPException(404, "Essa foto não existe.")
    if body.album is not None:
        p.album = _album(body.album)
    if body.title is not None:
        p.title = body.title.strip()[:160]
    await db.commit()
    await rt.publish("photo", user.id, "team")
    return {"id": p.id, "album": p.album, "title": p.title}


@router.post("/album")
async def rename_album(body: AlbumEdit, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Rename an album, or join it to another one (every photo in it moves)."""
    rows = (await db.execute(select(Photo).where(Photo.company == body.company, Photo.album == body.name))).scalars().all()
    to = _album(body.to)
    for p in rows:
        p.album = to
    await db.commit()
    await rt.publish("photo", user.id, "team")
    return {"moved": len(rows), "album": to}


@router.delete("/{photo_id}")
async def remove(photo_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(Photo, photo_id)
    if not p:
        raise HTTPException(404, "Essa foto não existe.")
    await db.delete(p)
    await db.commit()
    await rt.publish("photo", user.id, "team")
    return {"ok": True}
