# Agente AMG (team-agent) — notes for Claude

Read this after a `git clone` or `git pull`. The goal on every PC is the same: the widget is open and the person shows as online for the others.

## The team setup

- Three people: `owner` (shown as Kovel), `mark` (Marco), `david` (David). Windows PCs, all in the same **Radmin VPN** network.
- **Host = Kovel's PC**, Radmin IP `26.68.80.191`. The Hub (backend, port 8000) lives only there. Radmin IPs: Marco `26.244.76.112`, David `26.245.177.206`.
- The team key (`-Key`) is a secret: ask the person for it, never write it into the repo.
- **A member PC does not need the key** (2 Oct, David's PC was set up this way). `local_or_team_key`
  (`backend/app/routers/local.py`) lets a widget in by the key **or** by `only_local`, and the host's
  `WIDGET_NETWORKS=26.0.0.0/8` trusts the whole Radmin network. So when nobody remembers the key, write
  `~/.team-agent/widget.json` by hand — `{"hub_url": "http://26.68.80.191:8000", "user": "David"}`, no `key` —
  and run `.\scripts\iniciar.ps1`: the person shows online. With no key the widget also never starts a Hub of
  its own (`is_local` is false), so there is no second Hub to confuse things. The key is still needed on the
  host — it is what makes its Hub listen on `0.0.0.0` — and for a widget outside the Radmin network.

## Make it work

```powershell
git pull
# once per PC (the host runs it in an administrator PowerShell, without -HostIp):
.\scripts\configurar_widget.ps1 -Key <team key> -User Marco -HostIp 26.68.80.191
# every time, also after a git pull:
.\scripts\iniciar.ps1
```

`iniciar.ps1` creates `.venv` if missing, installs backend + widget requirements, closes an old widget and opens the new one with `pythonw` (no console; it survives closing the terminal).

## How it fits together

- `configurar_widget.ps1` writes `~/.team-agent/widget.json` (`key`, `user`, and `hub_url` when `-HostIp` is given). `TEAM_HUB_URL`, `TEAM_KEY`, `TEAM_WIDGET_USER` override it.
- On the host the widget starts the Hub itself when nothing answers on port 8000 (`widget/team_widget/hub.py`, `start_local_server`). It binds `0.0.0.0` only when a team key is set, otherwise `127.0.0.1`. Its database is `~/.team-agent/hub.db`, not `backend/dev.db`.
- That Hub runs with `backend/` as working directory, so it still reads `backend/.env` (not in git). On the host it holds `IP_USERS=127.0.0.1=owner,::1=owner,26.244.76.112=mark` (password-less Hub sign-in by computer; add `,<Radmin IP>=david` for David) and `WIDGET_NETWORKS=26.0.0.0/8`.
- Online status comes from the widget pinging `/api/local/presence` with the `X-Team-Key` header. The agent (`agent/`, token in `agent/.env`) is optional for being online.
- An agent token is tied to one database: a token issued against `backend/dev.db` is rejected by the widget-started Hub (`hub.db`) with `HTTPStatusError`.

## Someone is not online — check in this order

1. Same Radmin network? Each side must see the other in the Radmin VPN window. Ping can fail even when it works (Windows blocks ICMP), so test `http://26.68.80.191:8000/api/hub/companies` instead: 401 means the Hub answers.
2. Host: `netstat -ano | findstr :8000` must show `0.0.0.0:8000`. `127.0.0.1:8000` means the Hub started without the team key: run `configurar_widget.ps1` on the host again, then `iniciar.ps1`.
3. Host firewall: rule "Agente AMG Hub" must exist (TCP 8000, remote `26.0.0.0/8`). The broad `python.exe` allow rules that Windows creates stay disabled: the host has a public IP on its network adapter and those rules open the Hub to the internet.
4. After editing `backend/.env`, the Hub must be restarted: stop the `uvicorn app.main:app` process, then `iniciar.ps1`. If it was started from an administrator window, only an administrator can stop it.

## Working on the code

- Tests: `cd backend; ..\.venv\Scripts\python -m pytest -q` and the same in `agent`.
- Commit and push straight to `main`.
- Never commit `.env`, `widget.json`, tokens or the team key.
