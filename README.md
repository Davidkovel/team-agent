# Team Agent

У каждого сотрудника (Owner, Mark, David) — свой **Local Team Agent** на базе Claude, маленький **Desktop Widget** и личные задачи. У Owner — **Team Dashboard** со всеми агентами, задачами, activity, usage и approvals.

```
                ┌──────────────────┐
                │ Team Dashboard   │  frontend/ (static SPA)
                └────────┬─────────┘
                    REST + WebSocket
                ┌────────▼─────────┐
                │     Backend      │  backend/  FastAPI + PostgreSQL + Redis
                └────────┬─────────┘
          ┌──────────────┼──────────────┐
    ┌─────▼─────┐  ┌─────▼────┐  ┌──────▼───┐
    │Owner Agent│  │Mark Agent│  │David Agent│  agent/  (по одному на компьютер)
    └─────┬─────┘  └────┬─────┘  └────┬─────┘
       Widget        Widget        Widget       widget/ (локальный WebSocket)
       Claude        Claude        Claude       Claude Agent SDK
```

## Какой механизм Claude используется и почему

**Claude Agent SDK для Python (`claude-agent-sdk`)** — официальная библиотека, которая запускает agent loop Claude Code внутри вашего процесса: планирование шагов, управление контекстом, сессии с `resume`, MCP-инструменты, режимы разрешений.

| Вариант | Почему не он |
|---|---|
| Claude API (Messages) + свой цикл | Пришлось бы самим писать agent loop, управление контекстом и сохранение сессий — то, что SDK уже даёт. |
| Claude Code CLI вручную (`/agent`) | Интерактивный инструмент для человека; агент должен работать в фоне сам. |
| Managed Agents | Агент исполняется в облаке Anthropic, а не на компьютере сотрудника. |
| **Agent SDK** | Агент — отдельное локальное приложение, Claude — его reasoning engine. |

Как это устроено в коде (`agent/team_agent/providers/claude_sdk.py`):

- Встроенные инструменты Claude Code (Bash, Write, Edit, WebFetch…) **выключены**: `tools=[]`, `disallowed_tools`, `permission_mode="dontAsk"`, `setting_sources=[]`.
- Claude получает только наши инструменты через in-process MCP server (`create_sdk_mcp_server`). Каждый вызов идёт через `ToolRegistry` → `PermissionPolicy`. У AI нет прямого доступа к компьютеру.
- Сессия Claude сохраняется (`session_id` в задаче) и продолжается через `resume` после паузы или перезапуска.
- `AIProvider` — интерфейс; другой AI-движок подключается новой реализацией без изменения ядра.

### Usage: что доступно официально

SDK отдаёт в `ResultMessage` токены (`usage`) и **оценочную** стоимость (`total_cost_usd`). Это не биллинг: авторитетные данные — Usage and Cost API и Claude Console.

Процент лимита подписки («Claude usage 42%») через SDK **не доступен**. Поэтому widget показывает «Claude budget N%» — долю бюджета задачи (`TEAM_AGENT_MAX_BUDGET_USD`, по умолчанию $5). Цифры обновляются, когда запуск Claude завершается или ставится на паузу, а не после каждого шага.

## Быстрый старт

### 1. Сервер (один на команду)

```bash
cp .env.example .env        # заполнить все значения
docker compose up -d --build
```

Dashboard: http://localhost:8000. Пользователи `owner`, `mark`, `david` создаются при первом запуске с паролями из `.env`.

Без Docker, для разработки (SQLite, без Redis, один процесс):

```bash
python -m venv .venv && .venv/Scripts/pip install -r backend/requirements.txt   # Linux/macOS: .venv/bin/pip
cd backend
DATABASE_URL=sqlite+aiosqlite:///./dev.db REDIS_URL= JWT_SECRET=<32+ символов> ../.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

### 2. Agent (на компьютере каждого сотрудника)

```bash
pip install -r agent/requirements.txt -r widget/requirements.txt
cp agent/.env.example agent/.env
```

В `agent/.env`:

- `TEAM_SERVER_URL` — адрес сервера;
- `TEAM_AGENT_TOKEN` — войти в dashboard под своим пользователем → **Agent token** (показывается один раз; повторная выдача отзывает старый);
- `ANTHROPIC_API_KEY` — ключ Claude API этого сотрудника.

```bash
cd agent && python -m team_agent
```

### 3. Widget

```bash
cd widget && python -m team_widget
```

Закрытие окна сворачивает widget в tray; агент продолжает работать.

## Credentials

| Что | Где хранится | Зачем |
|---|---|---|
| `ANTHROPIC_API_KEY` | `agent/.env` на компьютере сотрудника | Доступ агента к Claude. |
| `TEAM_AGENT_TOKEN` | `agent/.env`; на сервере — только SHA-256 | Агент ↔ backend. Даёт доступ только к задачам своего пользователя. |
| Пароль пользователя | на сервере — PBKDF2-хэш | Вход в dashboard (JWT на 24 часа). |
| `local_api.token` | `~/.team-agent/<profile>/` | Widget ↔ agent, только `127.0.0.1`. |

По документации Agent SDK сторонним продуктам нельзя использовать логин claude.ai и лимиты подписки — только API key (или Bedrock / Vertex / Foundry, если настроить их переменные окружения).

Ключи не попадают в `agent.log` (маскируются фильтром) и не передаются процессам, которые запускает AI.

## Permissions агента

Каждый вызов инструмента классифицируется в `agent/team_agent/permissions/policy.py`:

| Уровень | Что входит | Поведение |
|---|---|---|
| **SAFE** | чтение и создание файлов в workspace задачи; `git status/diff/log/add/commit/branch`; тесты и линтеры из allowlist (`pytest`, `npm test`, `ruff`…); обновление статуса задачи; уведомления | выполняется сразу |
| **REQUIRES_APPROVAL** | удаление файлов; `.env*` и production-конфиги; `git push/merge/reset`; deploy, миграции, `kubectl`, `docker`, установка пакетов; любая команда вне allowlist; всё, о чём агент сам просит через `request_approval` (публикация рекламы и т. п.) | агент останавливается, статус `WAITING`, Owner жмёт Approve/Reject в dashboard |
| **BLOCKED** | пути вне workspace; чтение секретов; `.git` напрямую; `rm -rf`, `format`, `shutdown`, `sudo`; `curl`/`wget`/shell-интерпретаторы; операторы shell (`; & \| > $`); `git push --force`, `git config` | не выполняется, одобрить нельзя |

- Workspace задачи: `TEAM_AGENT_WORKSPACE/<project или task-ID>`.
- Команды запускаются без shell, одной программой, с таймаутом 300 с.
- Свой проект может расширить списки JSON-файлом (`TEAM_AGENT_POLICY_FILE`): ключи `safe_commands`, `approval_patterns`, `blocked_patterns`. Встроенные блокировки убрать нельзя.
- Если сервер недоступен, approval считается не полученным.

**Ограничение:** это политика на уровне приложения, а не sandbox ОС. Разрешённые тесты исполняют код, который написал агент. Для жёсткой изоляции запускайте агента под отдельным пользователем ОС, в контейнере или VM.

## Как работает агент

- **Задачи**: `TaskProvider` (интерфейс) → `RemoteTaskProvider` (backend). GitHub, Jira, Linear, Slack, Telegram добавляются новой реализацией `TaskProvider`.
- **Heartbeat** каждые 10 с: статус, задача, прогресс, действия. Presence лежит в Redis с TTL 30 с (`HEARTBEAT_TIMEOUT`); нет heartbeat → `OFFLINE`.
- **Прогресс** сообщает сам Claude через инструмент `update_progress`; backend сохраняет каждое действие в контекст задачи.
- **Память задачи** (PostgreSQL): описание, требования, действия, решения, ошибки, результат, `session_id`.
- **Recovery**: при старте агент спрашивает backend о незавершённой задаче, восстанавливает контекст и продолжает ту же сессию Claude с указанием сначала проверить состояние workspace. `TEAM_AGENT_RECOVERY_MODE=ask` — восстановить, но ждать кнопки Resume.
- **Команды** Pause / Resume / Stop приходят из widget и из dashboard.
- **Лог**: `~/.team-agent/<profile>/agent.log`.

Статусы агента: `ONLINE`, `WORKING`, `IDLE`, `WAITING`, `PAUSED`, `ERROR`, `OFFLINE`.

## Кто что видит

- **Owner**: все агенты с деталями, все задачи, activity, usage, approvals; только он принимает решения по approvals.
- **Mark / David**: свои задачи, activity, usage и approvals; о коллегах — только статус, название текущей задачи и прогресс.
- **Widget**: состояние своего агента и та же краткая информация о команде.

## Widget: выбор технологии

| | RAM | Размер | Tray | Что нужно для сборки |
|---|---|---|---|---|
| Electron | 150+ МБ | 100+ МБ | да | Node |
| Tauri | ~30 МБ | ~10 МБ | да | Rust toolchain + WebView2 |
| **Python: tkinter + pystray** | ~40 МБ | 0 (Python уже стоит для агента) | да | ничего |

Выбран Python: агенту Python уже нужен, поэтому нет второго runtime и шага сборки; старт меньше секунды; работает на Windows, macOS и Linux. Tauri выиграл бы по RAM и внешнему виду, но требует Rust на каждой машине сборки. Widget общается только с локальным WebSocket API агента (`agent/team_agent/transport/local_api.py`), поэтому его можно заменить на Tauri, не трогая агент и backend.

## Автозапуск (опционально)

Ничего не устанавливается без явной команды:

```bash
python scripts/autostart.py install    # агент и widget при входе пользователя
python scripts/autostart.py remove
```

Запускайте тем Python, в который установлены зависимости. Скрипт создаёт только пользовательские файлы:

- **Windows**: `team-agent.cmd` и `team-widget.cmd` в `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` (`pythonw`, без окна консоли).
- **macOS**: `~/Library/LaunchAgents/com.team.agent.plist` и `com.team.widget.plist`.
- **Linux**: `~/.config/autostart/team-agent.desktop` и `team-widget.desktop`.

## Новый пользователь

1. Добавить строку в `SEED_USERS` в `backend/app/main.py` — срабатывает только на пустой базе. Для существующей базы пользователя нужно вставить в таблицу `users` вручную: API управления пользователями в MVP нет.
2. Пользователь входит в dashboard → **Agent token**.
3. На его компьютере: шаги 2–3 из «Быстрого старта».

Несколько агентов на одной машине (для проверки): разные `TEAM_AGENT_PROFILE` и `TEAM_AGENT_LOCAL_PORT`.

## Что не реализовано и требует интеграции

- **Внешние системы** (Meta Ads, production deploy, базы данных): инструментов для них нет. Агент готовит черновики в workspace и запрашивает approval; саму публикацию нужно добавить как новый `Tool` (`agent/team_agent/tools/`) с проверкой в `PermissionPolicy`.
- **Процент лимита подписки Claude**: недоступен через SDK (см. Usage).
- **Semantic memory**: только контекст задачи в PostgreSQL.
- **Миграции БД**: таблицы создаются через `create_all`; для изменений схемы нужен Alembic.
- **Управление пользователями и смена пароля** через UI.
- **HTTPS**: ставьте backend за reverse proxy с TLS; сейчас токен dashboard передаётся в query string WebSocket.

## Тесты

```bash
cd backend && python -m pytest -q    # API, роли, approvals, recovery, WebSocket visibility
cd agent && python -m pytest -q      # policy, маскировка логов, жизненный цикл задачи
```

Тесты агента используют сценарный AI-провайдер вместо Claude и не тратят токены.

## Структура

```
agent/team_agent/
  core/         agent.py (жизненный цикл), state.py, config.py, logs.py
  providers/    AIProvider, ClaudeAgentProvider
  tools/        file, git, terminal, task, approval, notification + registry
  permissions/  PermissionPolicy (SAFE / REQUIRES_APPROVAL / BLOCKED)
  tasks/        TaskProvider, RemoteTaskProvider
  transport/    backend.py (HTTP + WS), local_api.py (для widget)
  storage/      local_store.py
widget/team_widget/   ui/ (window, tray), api/ (agent client), state/
backend/app/          models, security, realtime (Redis), routers/
frontend/             index.html, app.js, styles.css
scripts/autostart.py
```
