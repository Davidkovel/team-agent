"""E-mails (#/emails, 03 · Negócios): a linha toda, Radar > e-mail > resposta > CRM > agentes (3 nov 2026, pedido do David:
«o radar procura, aquilo manda e-mails, uma escola responde e perguntam-me logo o que fazer»).

Quem envia e lê é um só Hub: o que tem a conta (`ACCOUNT`, um ficheiro só dele, com a palavra-passe), que é a nuvem, sempre ligada.
Tudo o resto (conversas, mensagens, recusas, definições) vai por sync, por isso a página é igual no PC e no telemóvel. A regra:
- nada sai sem um sim de uma pessoa; rascunhos ficam por aprovar;
- sai aos poucos: dias úteis, das 9h às 18h de Lisboa, um de cada vez, com limite por dia, para a conta nova não cair no spam;
- cada e-mail diz quem somos e como recusar; quem responde REMOVER nunca mais recebe nada;
- muitas devoluções num dia param os envios sozinhas e avisam;
- uma resposta verdadeira avisa o telemóvel e fica à espera da decisão (PDF, condições, ignorar).
Não há «visto pelo cliente»: só um píxel escondido o diria, e isso prejudica a entrega e a lei. «Por ver» quer dizer por ver por nós.
"""
from __future__ import annotations

import asyncio
import email
import email.policy
import imaplib
import json
import logging
import random
import re
import smtplib
import socket
import ssl
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, parseaddr
from html import unescape
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import SessionLocal
from .models import MailMessage, MailOptOut, MailSettings, MailThread, User
from .radar import DIR as RADAR_DIR
from .radar import RADAR

log = logging.getLogger("team.mail")

ACCOUNT = Path.home() / ".team-agent" / "mail-account.json"
CURSOR = Path.home() / ".team-agent" / "mail-cursor.json"
CRM_SEEN = RADAR_DIR / "mail-crm.json"
try:
    LISBON = ZoneInfo("Europe/Lisbon")
except ZoneInfoNotFoundError:   # Windows has no time zones without the tzdata package, and the self-update does not run pip:
    LISBON = timezone.utc        # the Hub must still start (4 Nov: this line alone kept it down); an hour off in summer until iniciar.ps1 installs it
HOURS = (9, 18)
GAP = (180, 300)              # seconds between two first e-mails
FOLLOWUP_DAYS = 4             # a contact with no answer goes to «Enviar outra vez» after this
MAX_FOLLOWUPS = 2
BOUNCE_STOP = 5               # returned e-mails in a day that stop the sending
INBOX_EVERY = 60
OPT_OUT = "Se não quiser receber mais e-mails nossos, responda com a palavra REMOVER."
ADDRESS = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$")
SYSTEM_FROM = re.compile(r"^(mailer-daemon|postmaster|mail-daemon)@", re.I)
PRESETS = {"gmail.com": ("smtp.gmail.com", "imap.gmail.com"), "googlemail.com": ("smtp.gmail.com", "imap.gmail.com"),
           "outlook.com": ("smtp-mail.outlook.com", "outlook.office365.com"), "hotmail.com": ("smtp-mail.outlook.com", "outlook.office365.com"),
           "live.com": ("smtp-mail.outlook.com", "outlook.office365.com")}
_gap_until = 0.0
_inbox_at = 0.0
_wake = asyncio.Event()


def utc() -> datetime:
    return datetime.now(timezone.utc)


def aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


# ------------------------------------------------------------------ the account (one file, only on the Hub that sends)

def account() -> dict | None:
    try:
        acc = json.loads(ACCOUNT.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return acc if acc.get("address") and acc.get("password") else None


def fill_account(body: dict) -> dict:
    address = str(body.get("address") or "").strip().lower()
    password = re.sub(r"\s+", "", str(body.get("password") or ""))  # Google shows its app passwords with spaces
    if not ADDRESS.match(address) or not password:
        raise ValueError("Escreve o endereço e a palavra-passe da conta.")
    domain = address.rsplit("@", 1)[1]
    smtp_host, imap_host = PRESETS.get(domain, (f"mail.{domain}", f"mail.{domain}"))
    smtp_port = int(body.get("smtp_port") or (587 if "outlook" in smtp_host else 465))
    return {"address": address, "password": password, "smtp_host": str(body.get("smtp_host") or smtp_host).strip(), "smtp_port": smtp_port,
            "imap_host": str(body.get("imap_host") or imap_host).strip(), "imap_port": int(body.get("imap_port") or 993)}


def _smtp(acc: dict):
    if int(acc["smtp_port"]) == 465:
        smtp = smtplib.SMTP_SSL(acc["smtp_host"], 465, context=ssl.create_default_context(), timeout=30)
    else:
        smtp = smtplib.SMTP(acc["smtp_host"], int(acc["smtp_port"]), timeout=30)
        smtp.starttls(context=ssl.create_default_context())
    smtp.login(acc["address"], acc["password"])
    return smtp


def _imap(acc: dict):
    box = imaplib.IMAP4_SSL(acc["imap_host"], int(acc["imap_port"]), timeout=30)
    box.login(acc["address"], acc["password"])
    return box


def check_account(acc: dict) -> None:
    """Enter the account both ways before keeping it, and say in plain words what failed."""
    try:
        _smtp(acc).quit()
    except smtplib.SMTPAuthenticationError:
        raise ValueError("O endereço ou a palavra-passe não entraram. No Gmail é preciso uma palavra-passe de aplicação, não a normal.")
    except (OSError, smtplib.SMTPException) as e:
        raise ValueError(f"Não consegui ligar ao servidor de envio {acc['smtp_host']}: {e}")
    try:
        _imap(acc).logout()
    except imaplib.IMAP4.error:
        raise ValueError("O envio entrou, mas a leitura (IMAP) foi recusada. Confirma que o IMAP está ligado nas definições da conta.")
    except OSError as e:
        raise ValueError(f"Não consegui ligar ao servidor de leitura {acc['imap_host']}: {e}")


def save_account(acc: dict) -> None:
    ACCOUNT.parent.mkdir(parents=True, exist_ok=True)
    tmp = ACCOUNT.with_suffix(".tmp")
    tmp.touch(mode=0o600, exist_ok=True)
    tmp.chmod(0o600)
    tmp.write_text(json.dumps(acc), "utf-8")
    tmp.replace(ACCOUNT)
    CURSOR.unlink(missing_ok=True)  # a new mailbox: what is already in it is not news


def forget_account() -> None:
    ACCOUNT.unlink(missing_ok=True)
    CURSOR.unlink(missing_ok=True)


def cloud_url() -> str:
    """The always-on Hub, when this one is a PC: the account goes there, never onto a laptop that sleeps."""
    if not settings.sync or Path("/opt/amg/dados").is_dir():
        return ""
    return next((u.strip().rstrip("/") for u in settings.sync_relays.split(",") if "amg-nuvem" in u), "")


async def connect(body: dict) -> str:
    """Check and keep the account on the Hub that will send. Returns the address."""
    acc = fill_account(body)
    if url := cloud_url():
        try:
            async with httpx.AsyncClient(timeout=70) as c:
                r = await c.post(f"{url}/api/sync/mail-account", json=acc, headers={"X-Team-Key": settings.team_key})
        except httpx.HTTPError:
            raise ValueError("A nuvem não respondeu. Tenta outra vez daqui a um minuto.")
        if r.status_code != 200:
            try:
                raise ValueError(r.json().get("detail") or "A nuvem recusou a conta.")
            except json.JSONDecodeError:
                raise ValueError("A nuvem recusou a conta.")
        return acc["address"]
    await asyncio.to_thread(check_account, acc)
    save_account(acc)
    async with SessionLocal() as db:
        st = await get_settings(db)
        st.address, st.worker, st.last_error = acc["address"], socket.gethostname()[:100], ""
        await db.commit()
    return acc["address"]


async def get_settings(db: AsyncSession) -> MailSettings:
    st = await db.get(MailSettings, 1)
    if not st:
        st = MailSettings(id=1)
        db.add(st)
        await db.flush()
    return st


# ------------------------------------------------------------------ sending

def signature(st: MailSettings, address: str) -> str:
    who = st.footer.strip() or f"{st.from_name or address} · {address}"
    return f"\n\n--\n{who}\n{OPT_OUT}"


def build(acc: dict, st: MailSettings, thread: MailThread, msg: MailMessage, references: str = "") -> EmailMessage:
    out = EmailMessage()
    out["From"] = formataddr((st.from_name, acc["address"])) if st.from_name else acc["address"]
    out["To"] = thread.email
    out["Subject"] = msg.subject
    out["Message-ID"] = make_msgid(domain=acc["address"].rsplit("@", 1)[1])
    out["List-Unsubscribe"] = f"<mailto:{acc['address']}?subject=REMOVER>"
    if references:
        out["In-Reply-To"] = references
        out["References"] = references
    out.set_content(msg.body.rstrip() + signature(st, acc["address"]))
    for path in msg.attachments or []:
        p = Path(path)
        if not p.is_file():
            raise FileNotFoundError(f"Anexo não encontrado neste servidor: {p.name}")
        kind = {"pdf": ("application", "pdf"), "png": ("image", "png"), "jpg": ("image", "jpeg"), "jpeg": ("image", "jpeg")}.get(
            p.suffix.lstrip(".").lower(), ("application", "octet-stream"))
        out.add_attachment(p.read_bytes(), maintype=kind[0], subtype=kind[1], filename=p.name)
    return out


def _deliver(acc: dict, out: EmailMessage) -> None:
    smtp = _smtp(acc)
    try:
        smtp.send_message(out)
    finally:
        try:
            smtp.quit()
        except (OSError, smtplib.SMTPException):
            pass


def in_window(when: datetime | None = None) -> bool:
    t = (when or utc()).astimezone(LISBON)
    return t.weekday() < 5 and HOURS[0] <= t.hour < HOURS[1]


def wake() -> None:
    _wake.set()


async def send_next(acc: dict) -> bool:
    """Send what is due, at most one. Answers to someone who wrote to us go at once; the rest wait for their turn."""
    global _gap_until
    async with SessionLocal() as db:
        st = await get_settings(db)
        approved = list((await db.execute(select(MailMessage).where(MailMessage.status == "approved", MailMessage.direction == "out")
                                          .order_by(MailMessage.at))).scalars())
        if not approved:
            await db.commit()
            return False
        msg = next((m for m in approved if m.kind == "reply"), None)
        if not msg:
            midnight = utc().astimezone(LISBON).replace(hour=0, minute=0, second=0, microsecond=0)
            today = (await db.execute(select(func.count()).select_from(MailMessage).where(
                MailMessage.direction == "out", MailMessage.status == "sent", MailMessage.kind != "reply",
                MailMessage.at >= midnight.astimezone(timezone.utc)))).scalar() or 0
            if st.paused or not in_window() or today >= st.daily_cap or time.time() < _gap_until:
                await db.commit()
                return False
            msg = approved[0]
        thread = await db.get(MailThread, msg.thread_id)
        refused = (await db.execute(select(MailOptOut.id).where(MailOptOut.email == (thread.email if thread else "")))).first()
        if not thread or refused:
            msg.status, msg.error = "failed", "Esta empresa pediu para não receber e-mails."
            if thread:
                thread.status = "removido"
            await db.commit()
            return True
        refs = ""
        if msg.in_reply_to:
            refs = msg.in_reply_to
        else:
            refs = (await db.execute(select(MailMessage.message_id).where(MailMessage.thread_id == thread.id, MailMessage.message_id != "")
                                     .order_by(MailMessage.at.desc()))).scalars().first() or ""
        try:
            out = build(acc, st, thread, msg, refs)
        except OSError as e:
            msg.status, msg.error = "failed", str(e)
            thread.status, thread.error = "falhou", str(e)
            await db.commit()
            return True
        msg.status, msg.message_id = "sending", out["Message-ID"]  # written first: whatever happens next, it is never sent twice
        was_reply = msg.kind == "reply"
        mid = msg.id
        await db.commit()
    error = ""
    try:
        await asyncio.to_thread(_deliver, acc, out)
    except (OSError, smtplib.SMTPException) as e:
        error = str(e)[:500]
    if not was_reply:
        _gap_until = time.time() + random.randint(*GAP)
    async with SessionLocal() as db:
        msg = await db.get(MailMessage, mid)
        thread = await db.get(MailThread, msg.thread_id)
        msg.status, msg.error, msg.at = ("failed" if error else "sent"), error, utc()
        if error:
            thread.status, thread.error = "falhou", error
        else:
            thread.last_out_at, thread.error = utc(), ""
            if thread.status != "respondeu":
                thread.status = "enviado"
            if msg.kind == "followup":
                thread.followups = (thread.followups or 0) + 1
        await db.commit()
    return True


# ------------------------------------------------------------------ reading

def fetch_new(acc: dict) -> list[bytes]:
    """What came into the inbox since the last look, without marking it as read in the mailbox."""
    try:
        cur = json.loads(CURSOR.read_text("utf-8"))
    except (OSError, ValueError):
        cur = {}
    box = _imap(acc)
    try:
        box.select("INBOX", readonly=True)
        validity = (box.response("UIDVALIDITY")[1] or [b"0"])[0]
        validity = validity.decode() if isinstance(validity, bytes) else str(validity)
        _, data = box.uid("SEARCH", None, f"UID {int(cur.get('uid', 0)) + 1}:*")
        uids = [int(u) for u in (data[0] or b"").split()]
        last = int(cur.get("uid", 0))
        fresh = [u for u in uids if u > last]
        if not cur or cur.get("validity") != validity:  # first look at this mailbox: what is already there is not news
            _, data = box.uid("SEARCH", None, "ALL")
            every = [int(u) for u in (data[0] or b"").split()]
            _write_cursor(validity, max(every, default=0))
            return []
        out = []
        for uid in fresh[:50]:
            _, parts = box.uid("FETCH", str(uid), "(BODY.PEEK[])")
            raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
            if raw:
                out.append(raw)
            last = uid
        _write_cursor(validity, last)
        return out
    finally:
        try:
            box.logout()
        except (OSError, imaplib.IMAP4.error):
            pass


def _write_cursor(validity: str, uid: int) -> None:
    CURSOR.write_text(json.dumps({"validity": validity, "uid": uid}), "utf-8")


def _text_of(m) -> str:
    part = m.get_body(preferencelist=("plain", "html"))
    if not part:
        return ""
    try:
        text = part.get_content()
    except (LookupError, ValueError):
        return ""
    if part.get_content_type() == "text/html":
        text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text)
        text = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", text)
        text = unescape(re.sub(r"<[^>]+>", " ", text))
    return text


def only_new(text: str) -> str:
    """The person's words, without the copy of our e-mail that mail programs add below."""
    keep = []
    for line in text.replace("\r", "").split("\n"):
        s = line.strip()
        if s.startswith(">") or re.match(r"^(On .{5,120} wrote:|No dia .{5,120} escreveu:|Em .{5,120} escreveu:|De:\s.+@|From:\s.+@|-{3,}\s*(Original|Mensagem))", s):
            if s.startswith(">"):
                continue
            break
        keep.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(keep)).strip()


def parse(raw: bytes) -> dict:
    m = email.message_from_bytes(raw, policy=email.policy.default)
    name, addr = parseaddr(str(m.get("From") or ""))
    addr = addr.strip().lower()
    text = _text_of(m)
    refs = re.findall(r"<[^<>\s]+>", f"{m.get('In-Reply-To') or ''} {m.get('References') or ''}")
    ctype = m.get_content_type()
    bounce = bool(SYSTEM_FROM.match(addr)) or ctype == "multipart/report"
    failed = ""
    if bounce:
        whole = raw.decode("utf-8", "replace")
        hit = re.search(r"(?im)^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?", whole)
        failed = hit.group(1).lower() if hit else ""
        refs += re.findall(r"(?im)^Message-ID:\s*(<[^<>\s]+>)", whole)
    subject = str(m.get("Subject") or "")
    auto_head = str(m.get("Auto-Submitted") or "").lower()
    auto = (auto_head not in ("", "no") or bool(m.get("X-Autoreply") or m.get("X-Autorespond"))
            or bool(re.match(r"(?i)^(ausente|fora do escrit|out of office|automatic reply|resposta autom|auto:)", subject)))
    return {"from": addr, "name": str(name)[:200], "subject": subject[:300], "body": only_new(text)[:20000], "message_id": str(m.get("Message-ID") or "").strip()[:300],
            "refs": refs, "auto": auto, "bounce": bounce, "failed": failed}


async def _people(db: AsyncSession) -> list[int]:
    from .services import deciders
    return await deciders(db)


async def ingest(db: AsyncSession, item: dict) -> str:
    """Put one e-mail in its conversation and say what it was: resposta | remover | auto | devolvido | outro | repetido."""
    from .services import notify
    if item["message_id"] and (await db.execute(select(MailMessage.id).where(MailMessage.message_id == item["message_id"]))).first():
        return "repetido"
    thread = None
    for ref in item["refs"]:
        hit = (await db.execute(select(MailMessage).where(MailMessage.message_id == ref, MailMessage.direction == "out"))).scalars().first()
        if hit:
            thread = await db.get(MailThread, hit.thread_id)
            break
    if not thread:
        who = item["failed"] if item["bounce"] else item["from"]
        thread = (await db.execute(select(MailThread).where(MailThread.email == who).order_by(MailThread.created_at.desc()))).scalars().first() if who else None
    now_ = utc()

    def add(kind: str, seen: bool) -> None:
        db.add(MailMessage(thread_id=thread.id, direction="in", kind=kind, status="received", subject=item["subject"], body=item["body"],
                           message_id=item["message_id"], seen_at=now_ if seen else None, at=now_))

    if item["bounce"]:
        if not thread:
            return "outro"
        add("bounce", True)
        thread.status, thread.error = "falhou", "O e-mail voltou para trás: este endereço não recebe."
        await db.flush()
        since = now_ - timedelta(days=1)
        bounced = (await db.execute(select(func.count()).select_from(MailMessage).where(MailMessage.kind == "bounce", MailMessage.at >= since))).scalar() or 0
        st = await get_settings(db)
        await db.commit()
        if bounced >= BOUNCE_STOP and not st.paused:
            st.paused, st.pause_reason = True, f"{bounced} e-mails voltaram para trás em 24 horas. Parei os envios para proteger a conta."
            await db.commit()
            await notify(db, await _people(db), "mail_paused", "high", "Os envios de e-mail pararam", st.pause_reason, "#/emails")
        return "devolvido"
    if not thread:  # someone we never wrote to: it shows in Recebidos, without ringing
        thread = MailThread(email=item["from"][:200], nome=item["name"] or item["from"], status="outro", last_in_at=now_)
        db.add(thread)
        await db.flush()
        add("answer", False)
        await db.commit()
        return "outro"
    thread.last_in_at = now_
    if item["auto"]:
        add("auto", True)
        await db.commit()
        return "auto"
    first_words = re.sub(r"\s+", " ", item["body"])[:200]
    if re.search(r"\bremover\b", first_words, re.I) or re.search(r"(?i)^remover\b", item["subject"]):
        add("answer", True)
        if not (await db.execute(select(MailOptOut.id).where(MailOptOut.email == thread.email))).first():
            db.add(MailOptOut(email=thread.email))
        thread.status = "removido"
        for m in (await db.execute(select(MailMessage).where(MailMessage.thread_id == thread.id, MailMessage.status.in_(("draft", "approved"))))).scalars():
            m.status, m.error = "failed", "Esta empresa pediu para não receber e-mails."
        await db.commit()
        return "remover"
    add("answer", False)
    thread.status, thread.action = "respondeu", ""
    nome = thread.nome or thread.email
    await db.commit()
    await notify(db, await _people(db), "mail_reply", "high", f"{nome} respondeu ao e-mail", first_words[:160] or "Abre para ler e decidir.", "#/emails")
    return "resposta"


async def read_inbox(acc: dict) -> None:
    error = ""
    try:
        for raw in await asyncio.to_thread(fetch_new, acc):
            try:
                item = parse(raw)
                async with SessionLocal() as db:
                    await ingest(db, item)
            except Exception:
                log.exception("mail: a message could not be read")
    except (OSError, imaplib.IMAP4.error, ValueError) as e:
        error = f"Não consegui ler a caixa de entrada: {e}"[:400]
    async with SessionLocal() as db:
        st = await get_settings(db)
        st.last_check_at, st.last_error = utc(), error
        st.address, st.worker = acc["address"], socket.gethostname()[:100]
        await db.commit()


# ------------------------------------------------------------------ the CRM follows (on every Hub, where the lead lives)

async def crm_sweep() -> int:
    """The CRM and the Radar's follow-up are files on each computer: each Hub brings its own leads up to date from the conversations."""
    from .crm import _log, stage
    try:
        done = json.loads(CRM_SEEN.read_text("utf-8"))
    except (OSError, ValueError):
        done = {}
    leads = RADAR._leads()
    changed = 0
    async with SessionLocal() as db:
        threads = list((await db.execute(select(MailThread).where(MailThread.lead_key != ""))).scalars())
        await db.commit()
    for th in threads:
        if th.lead_key not in leads:
            continue
        mark = f"{th.status}|{th.followups}|{aware(th.last_in_at).timestamp() if th.last_in_at else 0}"
        if done.get(str(th.id)) == mark or th.status in ("rascunho", "fila"):
            continue
        before = (done.get(str(th.id)) or "").split("|")

        def fn(lead):
            now_stage, who = stage(lead), "E-mails"
            to = {"enviado": "contactado", "respondeu": "respondeu", "removido": "nao"}.get(th.status)
            order = ["novo", "contactado", "respondeu"]
            if to and now_stage in order and (to == "nao" or order.index(to) > order.index(now_stage)):
                lead["estado"] = to
                lead["hist"] = (lead.get("hist") or [])[-20:] + [[time.time(), to, who]]
            if th.status != (before[0] if before else ""):
                said = {"enviado": f"E-mail enviado para {th.email}.", "respondeu": f"Respondeu ao e-mail ({th.email}).",
                        "removido": f"Pediu para não receber mais e-mails ({th.email}).", "falhou": f"O e-mail não chegou: {th.error}",
                        "ignorado": "Resposta ignorada."}.get(th.status)
                if said:
                    _log(lead, "email", said, who)
        try:
            RADAR.edit_lead(th.lead_key, fn)
        except ValueError:
            continue
        done[str(th.id)] = mark
        changed += 1
    if changed:
        CRM_SEEN.parent.mkdir(parents=True, exist_ok=True)
        CRM_SEEN.write_text(json.dumps(done), "utf-8")
    return changed


async def tick() -> None:
    global _inbox_at
    await crm_sweep()
    acc = account()
    if not acc:
        return
    while await send_next(acc):  # only answers repeat at once: the others set the gap and stop the next turn
        if time.time() < _gap_until:
            break
    if time.time() >= _inbox_at:
        _inbox_at = time.time() + INBOX_EVERY
        await read_inbox(acc)


async def loop():
    """Always on where the Hub is on. Idle (only the CRM sweep) on a Hub without the account."""
    while True:
        try:
            await asyncio.wait_for(_wake.wait(), 20)
        except asyncio.TimeoutError:
            pass
        _wake.clear()
        try:
            await tick()
        except Exception:
            log.exception("mail: tick failed")


# ------------------------------------------------------------------ finding an address on a business's own site

SKIP_MAIL = re.compile(r"\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|wixpress|example|exemplo|domain|email|seudominio|yourdomain)\b|^(noreply|no-reply|donotreply)@", re.I)
FOUND = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def best_address(html: str, site: str) -> str:
    """A public address the business shows itself: first a mailto, then the text; its own domain wins."""
    found = [m.split("?")[0] for m in re.findall(r"mailto:([^\"'>\s]+)", html, re.I)] + FOUND.findall(unescape(html))
    found = [a.strip().lower() for a in found if ADDRESS.match(a.strip()) and not SKIP_MAIL.search(a.strip())]
    if not found:
        return ""
    host = re.sub(r"^www\.", "", httpx.URL(site).host or "") if site else ""
    return next((a for a in found if host and a.endswith("@" + host)), found[0])


async def find_address(c: httpx.AsyncClient, site: str) -> str:
    base = site if site.startswith("http") else f"https://{site}"
    for path in ("", "/contactos", "/contacto", "/contactos/", "/contact"):
        try:
            r = await c.get(base.rstrip("/") + path)
        except (httpx.HTTPError, ValueError):
            if not path:
                return ""
            continue
        if r.status_code == 200 and (a := best_address(r.text[:800000], base)):
            return a
    return ""


# ------------------------------------------------------------------ what the page and the agents ask for

SUBJECT = "{nome}: uma ideia para mais clientes"
FOLLOWUP = ("Olá,\n\nEnviei-lhe uma mensagem há uns dias e não sei se chegou a vê-la. Volto a deixá-la por cima, sem pressão.\n\n"
            "Se fizer sentido falarmos 15 minutos, é só responder a este e-mail. Se não for para si, diga-me e não insisto.")


async def queue(db: AsyncSession, who: str, emails: list[dict], status: str = "approved") -> dict:
    """Agents and campaigns come in here. `approved`: the person already said yes (the approval of the agent's batch)."""
    queued, skipped = 0, []
    refused = set((await db.execute(select(MailOptOut.email))).scalars())
    for item in emails:
        to = str(item.get("to") or "").strip().lower()
        if not ADDRESS.match(to):
            skipped.append(f"{to or '?'} (endereço inválido)")
            continue
        if to in refused:
            skipped.append(f"{to} (pediu para não receber)")
            continue
        thread = (await db.execute(select(MailThread).where(MailThread.email == to).order_by(MailThread.created_at.desc()))).scalars().first()
        if thread and item.get("new_only"):
            skipped.append(f"{to} (já está nesta lista)")
            continue
        replying = bool(thread and thread.status == "respondeu")
        if not thread:
            thread = MailThread(email=to, nome=str(item.get("nome") or to)[:200], ramo=str(item.get("ramo") or "")[:100], local=str(item.get("local") or "")[:200],
                                site=str(item.get("site") or "")[:300], lead_key=str(item.get("lead_key") or "")[:300], facts=item.get("facts") or [], created_by=who[:100])
            db.add(thread)
            await db.flush()
        if status == "approved" and thread.status != "respondeu":
            thread.status = "fila"
        db.add(MailMessage(thread_id=thread.id, direction="out", status=status, kind="reply" if replying else item.get("kind") or "agent",
                           subject=str(item.get("subject") or "")[:300], body=str(item.get("body") or ""), attachments=item.get("attachments") or [],
                           approved_by=who[:100] if status == "approved" else ""))
        queued += 1
    await db.commit()
    wake()
    return {"queued": queued, "skipped": skipped}
