"""«Aceitar tudo» (6 nov, David: «tou farto de ter que clicar para aceitar»). Um interruptor por pessoa em Sistema › Definições:
ligado, os pedidos de aprovação dos agentes dessa pessoa para ficheiros, comandos e git ficam aprovados no momento em que
chegam, sem toque e sem aviso. Continuam a pedir o toque: enviar e-mails e os pedidos que o agente faz de propósito
(publicar, gastar dinheiro, mexer em produção). O que a política bloqueia continua bloqueado: isto só salta o clique.
Fica neste Hub, em ~/.team-agent/aceitar-tudo.json: liga-se no Hub onde os agentes da pessoa correm (o da nuvem, no telemóvel).
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

SWITCH = Path.home() / ".team-agent" / "aceitar-tudo.json"   # {"david": {"on": true, "at": 1730900000}}
KINDS = {"file", "command", "git"}   # o que se aceita sozinho; "email" e "" (o agente a pedir de propósito) não


def _read() -> dict:
    try:
        data = json.loads(SWITCH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def is_on(username: str) -> bool:
    return bool(_read().get(username, {}).get("on"))


def set_on(username: str, on: bool) -> None:
    data = _read()
    data[username] = {"on": bool(on), "at": int(time.time())}
    SWITCH.parent.mkdir(parents=True, exist_ok=True)
    SWITCH.write_text(json.dumps(data, indent=1), encoding="utf-8")


def auto(username: str, kind: str) -> bool:
    """Este pedido aprova-se sozinho?"""
    return kind in KINDS and is_on(username)


def approve(approval, user_id: int) -> None:
    approval.status, approval.decided_by, approval.decided_at = "APPROVED", user_id, datetime.now(timezone.utc)
