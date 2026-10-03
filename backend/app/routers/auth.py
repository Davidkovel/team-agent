from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..models import User
from ..security import sees_all, current_user, make_jwt, new_agent_token, verify_password
from ..services import log_activity

router = APIRouter(prefix="/api")


class Login(BaseModel):
    username: str
    password: str


def user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role, "lead": sees_all(u), "team_mode": settings.team_mode,
            "has_agent_token": bool(u.agent_token_hash)}


@router.post("/auth/login")
async def login(body: Login, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    await log_activity(db, user, "login", f"{user.display_name} entrou no Hub")
    return {"token": make_jwt(user), "user": user_out(user)}


def ip_map() -> dict[str, str]:
    """The team's Radmin IPs first, then IP_USERS on top (it can add a computer or move one to another person)."""
    out: dict[str, str] = {}
    for raw in (settings.team_ip_users, settings.ip_users):
        for p in raw.split(","):
            if "=" in p:
                ip, login = p.split("=", 1)
                out[ip.strip()] = login.strip().lower()
    return out


@router.post("/auth/auto")
async def auto_login(request: Request, db: AsyncSession = Depends(get_db)):
    """No password: each computer's IP belongs to one person (IP_USERS)."""
    ip = request.client.host if request.client else ""
    username = ip_map().get(ip)
    user = username and (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, {"ip": ip})
    await log_activity(db, user, "login", f"{user.display_name} entrou no Hub")
    return {"token": make_jwt(user), "user": user_out(user)}


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return user_out(user)


@router.get("/users")
async def users(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return [user_out(u) for u in (await db.execute(select(User).order_by(User.id))).scalars()]


@router.post("/users/{username}/agent-token")
async def issue_agent_token(username: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Issues (or rotates) the token a Local Agent uses. Shown once; only the hash is stored."""
    if user.role != "owner" and user.username != username:
        raise HTTPException(403, "You can only issue a token for your own agent")
    target = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "User not found")
    raw, target.agent_token_hash = new_agent_token()
    await db.commit()
    await log_activity(db, user, "agent_token", f"{user.display_name} gerou o token do agente de {target.display_name}")
    return {"agent_token": raw}
