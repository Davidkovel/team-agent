# Agente AMG (team-agent) — notes for Claude

Read this after a `git clone` or `git pull`. The goal on every PC is the same: the widget is open, its own Hub runs and syncs with the others.

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

## No host: every PC runs its own Hub (since 4 Oct)

Kovel's PC used to be the host and had to be on for anyone to open the Hub. Not any more:

- On every PC the widget starts a Hub on `127.0.0.1:8000` with its own `~/.team-agent/hub.db` (`SYNC=1`, listening on `0.0.0.0`).
  A `hub_url` in `widget.json` that points at a `26.x` address is from the old setup and is ignored.
- `backend/app/sync.py`: every 5 s each Hub calls the other two Radmin IPs (`team_ip_users`) on `/api/sync/exchange` and they
  trade the rows that changed (`sync_log`; newest change to a row wins; deletes travel too). A PC that was off catches up when
  it meets any other PC; a task sent meanwhile rings in its widget then.
- New ids are `time * 4 + computer number` (owner 0, mark 1, david 2), so they never collide and still sort by age.
- Kovel's database is the team's (`origin` in `sync_meta`). A PC that never synced takes it whole the first time the two
  meet and drops its own local data. Until then its Hub is a separate, empty one.
- Sign-in: on each PC `127.0.0.1` is the person whose Radmin IP that PC has. Online/offline of the others is not synced.
- Only one of two PCs needs to accept connections for them to sync. Kovel's has the firewall rule; `iniciar.ps1` adds it on
  the others when run as administrator (needed only for Marco and David to sync with each other while Kovel is off).
- After a `git pull`: `.\scripts\iniciar.ps1`, and if a Hub from before is still running, stop that `uvicorn` first.
- The company library (`library/`) is files in git, not the database: it travels by commit, not by sync.

## Phone

No phone app of our own: `backend/app/push.py` sends every notification (`services.notify`) to the person's topic on
ntfy.sh, and the phone follows it in the ntfy app (bell → «Telemóvel» in the Hub shows the topic). Only the Hub where the
notification is made sends it. The phone cannot open the Hub: it is not in Radmin, and the Hub is not put on the internet.
`NTFY_URL=` (empty) switches it off.

**The AMG app's own notifications** (`backend/app/webpush.py`, `frontend/sw.js`): Web Push to the app added to the iPhone's home screen
(iOS 16.4+), which shows the app's name and icon and the task, unlike ntfy. Browsers only allow it over https, so the PC the phone opens
needs `tailscale serve --bg 8000` (after HTTPS is enabled for the tailnet in the admin console, DNS) and the phone must open
`https://<pc>.<tailnet>.ts.net`, add it to the home screen and tap «Ativar as notificações da app» (Mais, Notificações no telemóvel).
Subscriptions and the VAPID key live in `~/.team-agent/` (`webpush.json`, `vapid-private.pem`), never in the database: a phone belongs to
one Hub, which sends what is made on it and what arrives by sync. Needs `pywebpush` (in requirements); without it the Hub runs as before.
Whoever creates a task for themselves gets it on the phone too (not in the bell or the widget).

## Keep the Hub's Memória up to date (always)

Marco asked (6 Oct): everything we change in the widget or the Hub must also be written into the Hub's **Memória**
(Sistema > Memória), so the team, and every Team AI run that reads it before a task, knows the current state.
After a change that matters (a new behaviour, a decision, a rule, something that must never come back):

```powershell
.\.venv\Scripts\python scripts\memoria.py WIDGET "Vídeos no widget" "O que é verdade agora e porquê, em 2-4 frases."
.\.venv\Scripts\python scripts\memoria.py --list
```

Same title = the note is rewritten, not repeated: keep one note per subject with the current state, not a diary.
Categories in use: REGRAS, HUB, WIDGET, TELEMÓVEL, DESIGN. Team notes go to every PC by sync and into every task's
prompt, so keep them short, in Portuguese, and without secrets, IPs or keys.

The sections below were written for the old host setup; where they disagree with this one, this one is right.

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
- That Hub runs with `backend/` as working directory, so it still reads `backend/.env` (not in git). On the host it holds `IP_USERS=127.0.0.1=owner,::1=owner,26.244.76.112=mark` and `WIDGET_NETWORKS=26.0.0.0/8`.
- **Hub sign-in needs no password for the team.** The three Radmin IPs are built in (`team_ip_users` in `config.py`:
  owner, mark, david) and `IP_USERS` from `.env` goes on top (adds a computer or moves one to another person). Until 3 Oct
  David's IP was only meant to be added by hand to the host's `.env`, it never was, and his browser kept getting the
  password page. A new teammate = one more `ip=login` in `team_ip_users`, then the host pulls and restarts the Hub.
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

- Tests: `cd backend; ..\.venv\Scripts\python -m pytest -q` and the same in `agent`; the widget's Qt-free parts with
  `cd widget; ..\.venv\Scripts\python -m pytest tests -q`.
- Commit and push straight to `main`.
- Never commit `.env`, `widget.json`, tokens or the team key.
