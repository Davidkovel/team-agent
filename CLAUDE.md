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

## The Team AI Hub (what is where)

Four different things, never mixed: a **User** (person), their **Local Team Agent** (`agent/`, a background process, one per
person), an **AgentSession** (one run of Claude by that agent: a task, a question from the Hub, a weekly report) and a
**Subagent** (research / coding / testing / review, spawned inside a session). The Qt widget (`widget/`) is only the
control surface of the agent; it is not the agent.

- **Database changes**: only through `backend/app/migrate.py`. Add the column or table to `models.py`, bump `SCHEMA_VERSION`;
  on start the Hub creates what is missing, never drops anything, and copies a SQLite database to `hub.db.bak-<date>` before
  changing it. New columns must be nullable or have a plain default.
- **API** (`backend/app/routers/`): `agents.py` (agents, sessions, subagents, and the agent's reports), `work.py` (projects,
  memory, expenses, notifications, attention, search, company overview), `analytics.py`, `ai.py` (questions and the weekly
  report), `tasks.py` (board, edit, assign to AI).
- **No AI in the Hub**: the Hub holds no API key. A question (`/api/ai/ask`) is queued for the asker's own agent, which runs
  Claude on the data the Hub gathered and posts the answer back. No agent connected = no answer, and the UI says so.
- **Where numbers come from**: every figure is `live`, `calculated`, `estimated` (cost is always the SDK's estimate) or
  `not_connected`. A missing source is shown as missing, never as zero. Do not add demo data.
- **Frontend** (`frontend/`, no build step): `hub/design.css` is the design system (tokens + components), `hub/ui.js` the
  components and `t()` (Portuguese text is its own key; another language is one more dictionary in `I18N`), `hub/home.js` the
  widget grid, `hub/pages.js` the pages, `hub/shell.js` notifications, Ctrl+K and the Team AI. `app.js` and `styles.css` are
  the older pages (company library, media player, code feed, week). After changing any of them, bump `?v=` in `index.html`.
- **Agent** (`agent/team_agent/`): `providers/claude_sdk.py` runs the SDK with only our tools, `strict_mcp_config` (the
  account's connectors are not loaded) and background tasks off; `core/session.py` reports the run to the Hub.
  `TEAM_AGENT_SUBAGENTS=0` switches subagents off.

To try changes without touching the real Hub: a second server on another port with its own database, from `backend/`:
`DATABASE_URL=sqlite+aiosqlite:///C:/tmp/dev.db REDIS_URL= ..\.venv\Scripts\python -m uvicorn app.main:app --port 8010`.

## Working on the code

- Tests: `cd backend; ..\.venv\Scripts\python -m pytest -q` and the same in `agent`.
- Commit and push straight to `main`.
- Never commit `.env`, `widget.json`, tokens or the team key.
