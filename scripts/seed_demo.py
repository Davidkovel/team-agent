"""Fills this week's ledger with SAMPLE history (logins, tasks, edits) so the tables are not empty while testing.

    python scripts/seed_demo.py            add the sample rows
    python scripts/seed_demo.py --remove   delete them again

Sample rows are marked (activity.company / task.project = "__demo__"); the Hub labels the ledger "DADOS DE EXEMPLO" while any exist.
Uses the local Hub database (~/.team-agent/hub.db) unless DATABASE_URL is set. Run it with the backend's Python (.venv).
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path.home() / '.team-agent' / 'hub.db').as_posix()}")
os.environ.setdefault("REDIS_URL", "")
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import delete, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Activity, Task, User  # noqa: E402

DEMO = "__demo__"
# per person: weekdays (0 = Monday) with a login, tasks done / still open, library edits
PLAN = {
    "owner": {"days": [0, 1, 2, 3, 4], "done": ["Rever contas e pagamentos da semana", "Aprovar anúncios da BareDesk"], "open": ["Planear campanha de Outubro"], "edits": 2},
    "mark": {"days": [0, 2, 4], "done": ["Criar 3 criativos para Meta Ads", "Escrever textos da landing page", "Atualizar vídeos no Hub"], "open": ["Montar reel novo", "Rever legendas PT-PT"], "edits": 4},
    "david": {"days": [1], "done": ["Testar o checkout da loja"], "open": ["Atualizar stock no Shopify", "Responder aos clientes", "Preparar relatório mensal"], "edits": 0},
}


async def add():
    now = datetime.now(timezone.utc)
    monday = (now.astimezone() - timedelta(days=now.astimezone().weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    async with SessionLocal() as db:
        users = {u.username: u for u in (await db.execute(select(User))).scalars()}
        boss = users.get("owner") or next(iter(users.values()))
        for username, plan in PLAN.items():
            user = users.get(username)
            if not user:
                continue
            for i, day in enumerate(plan["days"]):
                if monday + timedelta(days=day) > now.astimezone():
                    continue  # no history in the future
                at = (monday + timedelta(days=day, hours=9, minutes=10 + 7 * i)).astimezone(timezone.utc)
                db.add(Activity(user_id=user.id, kind="login", message=f"{user.display_name} entrou no Hub", company=DEMO, created_at=at))
            for n in range(plan["edits"]):
                at = (monday + timedelta(days=plan["days"][n % len(plan["days"])], hours=11, minutes=5 * n)).astimezone(timezone.utc)
                if at <= now:
                    db.add(Activity(user_id=user.id, kind="library_edit", message=f"{user.display_name} editou um documento em BareDesk", company=DEMO, created_at=at))
            for n, title in enumerate(plan["done"]):
                at = (monday + timedelta(days=plan["days"][n % len(plan["days"])], hours=15, minutes=20)).astimezone(timezone.utc)
                at = min(at, now)
                db.add(Task(title=title, assignee_id=user.id, created_by=boss.id, status="COMPLETED", progress=100, project=DEMO,
                            created_at=at - timedelta(hours=4), started_at=at - timedelta(hours=3), completed_at=at))
                db.add(Activity(user_id=user.id, kind="task_done", message=f"{user.display_name} concluiu: {title}", company=DEMO, created_at=at))
            for title in plan["open"]:
                db.add(Task(title=title, assignee_id=user.id, created_by=boss.id, status="ASSIGNED", progress=0, project=DEMO))
        await db.commit()
    print("sample history added")


async def remove():
    async with SessionLocal() as db:
        a = await db.execute(delete(Activity).where(Activity.company == DEMO))
        t = await db.execute(delete(Task).where(Task.project == DEMO))
        await db.commit()
    print(f"removed {a.rowcount} activity rows and {t.rowcount} tasks")


if __name__ == "__main__":
    asyncio.run(remove() if "--remove" in sys.argv else add())
