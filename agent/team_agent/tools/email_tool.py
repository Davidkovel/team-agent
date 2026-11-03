"""Sending e-mails from the person's own account, never without their yes (3 Nov, David: «um agente procura escolas de
condução e outro manda-lhes e-mail»).

The whole batch (each address, subject and text) goes to the Hub as one approval, so the person reads it on the phone and
approves with one tap. Only then does the agent send it, over SMTP with the account in the agent's .env (for Gmail an app
password: myaccount.google.com/apppasswords). Every e-mail ends with who sends it and how to say no (RGPD), and an address
that said no (nao-enviar.txt in the agent's data folder) is never written to again."""
import asyncio
import mimetypes
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

from ..permissions import Level
from .base import STR, Tool, ToolResult, schema

MAX = 50                       # e-mails in one approval
ADDRESS = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$")
OPT_OUT = "Se não quiser receber mais e-mails meus, responda «REMOVER» e não volto a escrever."


def settings() -> dict:
    env = os.environ.get
    return {"host": env("SMTP_HOST", "smtp.gmail.com"), "port": int(env("SMTP_PORT", "465")), "user": env("SMTP_USER", ""),
            "password": env("SMTP_PASSWORD", ""), "name": env("EMAIL_FROM_NAME", ""), "footer": env("EMAIL_FOOTER", "")}


def opt_out_file() -> Path:
    return Path(os.environ.get("TEAM_AGENT_DATA_DIR", Path.home() / ".team-agent" / "default")) / "nao-enviar.txt"


def refused() -> set[str]:
    try:
        return {line.strip().lower() for line in opt_out_file().read_text(encoding="utf-8").splitlines() if line.strip()}
    except OSError:
        return set()


def footer(cfg: dict) -> str:
    """Who writes and how to refuse: the law asks for it in an e-mail to a business that does not know us."""
    who = cfg["footer"] or f"{cfg['name'] or cfg['user']} · {cfg['user']}"
    return f"\n\n--\n{who}\n{OPT_OUT}"


def build(cfg: dict, item: dict, files: list[Path]) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((cfg["name"], cfg["user"])) if cfg["name"] else cfg["user"]
    msg["To"], msg["Subject"] = item["to"], item["subject"]
    msg["List-Unsubscribe"] = f"<mailto:{cfg['user']}?subject=REMOVER>"
    msg.set_content(item["body"].rstrip() + footer(cfg))
    for path in files:
        kind = (mimetypes.guess_type(path.name)[0] or "application/octet-stream").split("/", 1)
        msg.add_attachment(path.read_bytes(), maintype=kind[0], subtype=kind[1], filename=path.name)
    return msg


def send_all(cfg: dict, messages: list[EmailMessage]) -> list[str]:
    errors = []
    with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=ssl.create_default_context(), timeout=30) as smtp:
        smtp.login(cfg["user"], cfg["password"])
        for msg in messages:
            try:
                smtp.send_message(msg)
            except smtplib.SMTPException as exc:
                errors.append(f"{msg['To']}: {exc}")
    return errors


async def hub_queue(ctx):
    """The Hub's connection when the team's e-mail is connected there; else None and this agent's own account is used."""
    backend = getattr(ctx.bridge, "backend", None)
    try:
        return backend if backend and await backend.mail_connected() else None
    except Exception:
        return None


class SendEmails(Tool):
    name = "send_emails"
    description = ("Send e-mails from the owner's own account. Give the whole batch at once: the owner reads every address and "
                   "text and approves it (one approval for the batch); nothing is sent before. Write each e-mail to one "
                   "business, short and personal, in its language. Only public business addresses you found on their site or "
                   "listing. The sender line and the opt-out line are added for you. Attachments are paths in the workspace.")
    schema = schema(["emails"], emails={"type": "array", "maxItems": MAX, "items": schema(
        ["to", "subject", "body"], to=STR, subject=STR, body=STR, attachments={"type": "array", "items": STR})})

    def summary(self, args):
        return f"enviar {len(args['emails'])} e-mail(s)"

    async def run(self, args, ctx):
        cfg = settings()
        hub = await hub_queue(ctx)
        if hub:  # the team's account on the Hub: it sends in turn, reads the answers and shows it all on the page E-mails
            cfg = {**cfg, "user": cfg["user"] or "a conta da empresa"}
        elif not cfg["user"] or not cfg["password"]:
            return ToolResult("E-mail is not set up on this agent (SMTP_USER / SMTP_PASSWORD in its .env). Leave the e-mails as "
                              "a draft file in the workspace and say so in the result.", True)
        no, seen, batch, skipped = refused(), set(), [], []
        for item in args["emails"]:
            to = item["to"].strip().lower()
            if not ADDRESS.match(to):
                skipped.append(f"{item['to']} (endereço inválido)")
            elif to in no:
                skipped.append(f"{to} (pediu para não receber)")
            elif to in seen:
                skipped.append(f"{to} (repetido)")
            else:
                seen.add(to)
                paths = item.get("attachments") or []
                if bad := [p for p in paths if ctx.policy.check_path(p, "read").level is Level.BLOCKED]:
                    return ToolResult(f"Attachment not allowed (outside the workspace or a secret): {', '.join(bad)}", True)
                files = [ctx.policy.resolve(p) for p in paths]
                if missing := [str(p) for p in files if not p.is_file()]:
                    return ToolResult(f"Attachment not found: {', '.join(missing)}", True)
                batch.append(({**item, "to": to}, files))
        if not batch:
            return ToolResult(f"Nothing to send. Skipped: {'; '.join(skipped)}", True)
        texts = [f"Para: {it['to']}\nAssunto: {it['subject']}\n"
                 f"{('Anexos: ' + ', '.join(p.name for p in fs) + chr(10)) if fs else ''}\n{it['body'].rstrip()}{footer(cfg)}"
                 for it, fs in batch]
        detail = f"De {cfg['user']} para {len(batch)} empresa(s): {', '.join(it['to'] for it, _ in batch)}"
        if skipped:
            detail += f". Ficam de fora: {'; '.join(skipped)}"
        meta = {"risk": "high", "kind": "email", "files": [], "diff": ("\n\n" + "=" * 40 + "\n\n").join(texts)[:60000]}
        if not await ctx.bridge.request_approval(f"Enviar {len(batch)} e-mail(s)", detail, meta):
            return ToolResult("REJECTED by the owner: nothing was sent. Do not retry; keep the texts as a draft.", True)
        if hub:
            out = await hub.queue_emails([{"to": it["to"], "subject": it["subject"], "body": it["body"], "attachments": [str(p) for p in fs]} for it, fs in batch])
            await ctx.bridge.record("action", f"E-mails na fila do Hub: {out['queued']} de {len(batch)}")
            text = (f"Queued {out['queued']} of {len(batch)} e-mails: the Hub sends them a few at a time in working hours; "
                    "answers appear on the page E-mails and the owner decides what follows.")
            gone = skipped + out["skipped"]
            return ToolResult(text + (" Skipped: " + "; ".join(gone) if gone else ""), out["queued"] == 0)
        errors = await asyncio.to_thread(send_all, cfg, [build(cfg, it, fs) for it, fs in batch])
        sent = len(batch) - len(errors)
        await ctx.bridge.record("action", f"E-mails enviados: {sent} de {len(batch)}")
        text = f"Sent {sent} of {len(batch)} e-mails."
        if errors:
            text += " Failed: " + "; ".join(errors)
        if skipped:
            text += " Skipped: " + "; ".join(skipped)
        return ToolResult(text, sent == 0)
