import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db
from .models import User

AGENT_TOKEN_PREFIX = "agt_"


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt = stored.split("$", 1)[0]
    return hmac.compare_digest(hash_password(password, salt), stored)


def make_jwt(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_ttl_hours)
    return jwt.encode({"sub": str(user.id), "exp": exp}, settings.jwt_secret, algorithm="HS256")


def new_agent_token() -> tuple[str, str]:
    """Returns (raw token shown once, hash stored in DB)."""
    raw = AGENT_TOKEN_PREFIX + secrets.token_urlsafe(32)
    return raw, hash_agent_token(raw)


def hash_agent_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def user_from_jwt(token: str, db: AsyncSession) -> User | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return await db.get(User, int(payload["sub"]))


async def user_from_agent_token(token: str, db: AsyncSession) -> User | None:
    if not token.startswith(AGENT_TOKEN_PREFIX):
        return None
    result = await db.execute(select(User).where(User.agent_token_hash == hash_agent_token(token)))
    return result.scalar_one_or_none()


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    return authorization[7:]


async def current_user(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)) -> User:
    user = await user_from_jwt(_bearer(authorization), db)
    if not user:
        raise HTTPException(401, "Invalid token")
    return user


def sees_all(user: User) -> bool:
    return settings.team_mode or user.role == "owner"


async def require_owner(user: User = Depends(current_user)) -> User:
    if not sees_all(user):
        raise HTTPException(403, "Owner only")
    return user


async def agent_user(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)) -> User:
    user = await user_from_agent_token(_bearer(authorization), db)
    if not user:
        raise HTTPException(401, "Invalid agent token")
    return user
