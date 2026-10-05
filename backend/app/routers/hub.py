import asyncio
import mimetypes
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import commits, hub
from ..db import get_db
from ..models import Activity, Meter, User
from ..realtime import rt
from ..security import current_user, hash_password, require_owner, user_from_jwt
from ..services import iso, log_activity
from .auth import user_out

router = APIRouter(prefix="/api")

USERNAME_RE = re.compile(r"^[a-z0-9_]{2,30}$")


class FileBody(BaseModel):
    content: str


METER_SERVICES = {"higgsfield"}


class MeterBody(BaseModel):
    pct: int = Field(ge=0, le=100)


class NewUser(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "member"


def _section_or_404(company_id: str, section_id: str) -> tuple[dict, dict]:
    found = hub.get_section(company_id, section_id)
    if not found:
        raise HTTPException(404, "Section not found")
    return found


@router.get("/hub/companies")
async def list_companies(user: User = Depends(current_user)):
    out = []
    for company in hub.companies().values():
        sections = []
        for s in company.get("sections", []):
            listing = hub.list_section(company["id"], s)
            sections.append({"id": s["id"], "label": s["label"], "icon": s.get("icon", ""), "kind": s["kind"],
                             "description": s.get("description", ""), "editable": bool(s.get("editable")),
                             "count": len(listing["items"])})
        out.append({"id": company["id"], "name": company["name"], "short": company.get("short", company["name"]),
                    "tagline": company.get("tagline", ""), "sections": sections})
    return out


@router.get("/hub/{company_id}/{section_id}")
async def section_items(company_id: str, section_id: str, user: User = Depends(current_user)):
    _, section = _section_or_404(company_id, section_id)
    return hub.list_section(company_id, section) | {"kind": section["kind"], "editable": bool(section.get("editable")),
                                                    "manage": hub.manageable(section)}


@router.get("/hub/{company_id}/{section_id}/file")
async def read_file(company_id: str, section_id: str, id: str, user: User = Depends(current_user)):
    _, section = _section_or_404(company_id, section_id)
    path = hub.resolve_item(section, id)
    if not path or path.stat().st_size > hub.MAX_TEXT_BYTES:
        raise HTTPException(404, "File not found or too large to show")
    return {"name": path.name, "content": path.read_text(encoding="utf-8", errors="replace"),
            "editable": bool(section.get("editable"))}


@router.put("/hub/{company_id}/{section_id}/file")
async def write_file(company_id: str, section_id: str, id: str, body: FileBody,
                     user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    company, section = _section_or_404(company_id, section_id)
    if not section.get("editable"):
        raise HTTPException(403, "This section is read-only")
    path = hub.resolve_item(section, id)
    if not path:
        raise HTTPException(404, "File not found")
    path.write_text(body.content, encoding="utf-8", newline="")
    await log_activity(db, user, "library_edit",
                       f"{user.display_name} editou {path.name} em {company['name']} › {section['label']}",
                       company=company["id"])
    return {"ok": True}


@router.get("/hub/{company_id}/{section_id}/media")
async def media(company_id: str, section_id: str, id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    # <video>/<img> cannot send an Authorization header, so media accepts the JWT as a query parameter.
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    _, section = _section_or_404(company_id, section_id)
    path = hub.resolve_item(section, id)
    if not path:
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")


@router.get("/hub/{company_id}/{section_id}/path")
async def media_path(company_id: str, section_id: str, id: str, request: Request, token: str = Query(...),
                     db: AsyncSession = Depends(get_db)):
    """Where a media file is on this computer, only for a caller on this computer: the widget's player opens it from
    disk (instant) instead of over HTTP, where Qt's FFmpeg takes seconds to start."""
    if not request.client or request.client.host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "Only from this computer")
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    _, section = _section_or_404(company_id, section_id)
    path = hub.resolve_item(section, id)
    if not path:
        raise HTTPException(404, "File not found")
    return {"path": str(path)}


_posters = asyncio.Semaphore(2)   # ffmpeg runs at most twice at a time, so a big gallery never hogs the CPU


@router.get("/hub/{company_id}/{section_id}/poster")
async def video_poster(company_id: str, section_id: str, id: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """A still JPEG of a video for galleries and playlists (404 when this server has no ffmpeg)."""
    if not await user_from_jwt(token, db):
        raise HTTPException(401, "Invalid token")
    _, section = _section_or_404(company_id, section_id)
    path = hub.resolve_item(section, id)
    if not path or section["kind"] != "videos":
        raise HTTPException(404, "File not found")
    async with _posters:
        jpg = await asyncio.to_thread(hub.poster, path)
    if not jpg:
        raise HTTPException(404, "No poster")
    return FileResponse(jpg, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


class ItemOp(BaseModel):
    id: str
    name: str = ""    # rename
    folder: str = ""  # move ("" = the section's top folder)


OPS = {
    "rename": ("renomeou", lambda s, b: hub.rename_item(s, b.id, b.name)),
    "move": ("moveu", lambda s, b: hub.move_item(s, b.id, b.folder)),
    "trash": ("mandou para o lixo", lambda s, b: hub.trash_item(s, b.id)),
    "restore": ("restaurou do lixo", lambda s, b: hub.restore_item(s, b.id)),
    "purge": ("apagou de vez", lambda s, b: hub.purge_item(s, b.id)),
}


@router.get("/hub/{company_id}/{section_id}/trash")
async def section_trash(company_id: str, section_id: str, user: User = Depends(current_user)):
    _, section = _section_or_404(company_id, section_id)
    return {"items": hub.list_trash(section) if hub.manageable(section) else [], "kind": section["kind"]}


@router.post("/hub/{company_id}/{section_id}/trash/empty")
async def empty_section_trash(company_id: str, section_id: str, user: User = Depends(current_user),
                              db: AsyncSession = Depends(get_db)):
    company, section = _section_or_404(company_id, section_id)
    if not hub.purgeable(section):
        raise HTTPException(403, "Daqui só se restaura: apagar de vez é só nos vídeos e nas fotos.")
    gone = hub.empty_trash(section)
    await log_activity(db, user, "library_purge", f"{user.display_name} esvaziou o lixo ({gone}) em {company['name']} › {section['label']}",
                       company=company["id"])
    return {"ok": True, "deleted": gone}


@router.post("/hub/{company_id}/{section_id}/item/{op}")
async def manage_item(company_id: str, section_id: str, op: str, body: ItemOp,
                      user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    company, section = _section_or_404(company_id, section_id)
    if op not in OPS:
        raise HTTPException(404, "Unknown action")
    if not hub.manageable(section):
        raise HTTPException(403, "Esta secção não se gere por aqui.")
    verb, run = OPS[op]
    old_name = body.id.split(":", 1)[-1].rsplit("/", 1)[-1]
    try:
        new_id = run(section, body)
    except hub.ManageError as e:
        raise HTTPException(400, str(e))
    detail = {"rename": f" para {body.name.strip()}", "move": f" para {body.folder.strip() or 'a pasta principal'}"}.get(op, "")
    await log_activity(db, user, f"library_{op}", f"{user.display_name} {verb} {old_name}{detail} em {company['name']} › {section['label']}",
                       company=company["id"])
    return {"ok": True, "id": new_id}


@router.get("/work/{company_id}")
async def company_work(company_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Who worked on this company: a count per person and the latest things done."""
    if company_id not in hub.companies():
        raise HTTPException(404, "Company not found")
    query = select(Activity).where(Activity.company == company_id).order_by(Activity.id.desc()).limit(300)
    rows = (await db.execute(query)).scalars().all()
    people: dict[str, dict] = {}
    for a in rows:
        entry = people.setdefault(a.user.username, {"user": a.user.username, "name": a.user.display_name,
                                                    "count": 0, "last": iso(a.created_at)})
        entry["count"] += 1
    return {"people": sorted(people.values(), key=lambda p: -p["count"]),
            "items": [{"id": a.id, "user": a.user.username, "name": a.user.display_name, "message": a.message,
                       "task_id": a.task_id, "created_at": iso(a.created_at)} for a in rows[:8]]}


@router.get("/history")
async def history(limit: int = 100, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """What everyone did, whether or not they wrote it down. Visible to the whole team."""
    rows = (await db.execute(select(Activity).order_by(Activity.id.desc()).limit(min(limit, 300)))).scalars()
    return [{"id": a.id, "user": a.user.username, "name": a.user.display_name, "kind": a.kind,
             "message": a.message, "task_id": a.task_id, "company": a.company, "created_at": iso(a.created_at)} for a in rows]


@router.get("/commits")
async def commits_feed(limit: int = 40, user: User = Depends(current_user)):
    """Latest commits across the team's repositories (GitHub first, local git as fallback)."""
    return await asyncio.to_thread(commits.recent, min(max(limit, 1), 100))


@router.get("/repos")
async def repos_recent(user: User = Depends(current_user)):
    """The team's repositories, the one with the latest commit first."""
    return await asyncio.to_thread(commits.projects)


@router.put("/meters/{service}")
async def set_meter(service: str, body: MeterBody, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Each person sets their own % for services we cannot read automatically."""
    if service not in METER_SERVICES:
        raise HTTPException(404, "Unknown meter")
    meter = await db.get(Meter, (user.id, service))
    if not meter:
        meter = Meter(user_id=user.id, service=service)
        db.add(meter)
    meter.pct = body.pct
    await db.commit()
    await log_activity(db, user, "meter", f"{user.display_name} atualizou o consumo de {service.capitalize()} para {body.pct}%")
    await rt.publish("presence", user.id, "team")
    return {"service": service, "pct": meter.pct}


@router.post("/users")
async def create_user(body: NewUser, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(422, "Username: 2-30 letters, digits or _")
    if len(body.password) < 8:
        raise HTTPException(422, "Password needs at least 8 characters")
    if body.role not in ("member", "owner"):
        raise HTTPException(422, "Role must be member or owner")
    if (await db.execute(select(User).where(User.username == username))).scalar_one_or_none():
        raise HTTPException(409, "Username already exists")
    user = User(username=username, display_name=body.display_name.strip() or username, role=body.role,
                password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await log_activity(db, owner, "user_created", f"{owner.display_name} criou o utilizador {user.display_name}")
    return user_out(user)
