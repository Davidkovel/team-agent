# Team Agent nesta máquina — o que falta

O repositório está em `C:\Users\david\Documents\team-agent` e o Python 3.12 já está instalado.
Os ficheiros de configuração já estão escritos:

- `.env` — passwords do painel e segredo do JWT (já preenchido).
- `agent\.env` — endereço do servidor já preenchido; falta só o **Agent token**.
  A chave da Claude pode ficar vazia: assim o agente usa o login da Claude Code deste computador.

Falta correr quatro comandos. Em PowerShell, dentro de `C:\Users\david\Documents\team-agent`:

## 1. Preparar o ambiente (uma vez)

```
py -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt -r agent\requirements.txt -r widget\requirements.txt
```

## 2. Servidor + painel

```
cd backend
$env:DATABASE_URL="sqlite+aiosqlite:///./dev.db"; $env:REDIS_URL=""; $env:JWT_SECRET=(Get-Content ..\.env | Select-String '^JWT_SECRET=').ToString().Split('=')[1]
..\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Painel em http://localhost:8000. Utilizadores `owner`, `marco` e `david`, com as passwords do `.env`.

## 3. Agent token

No painel, entrar como `david` → **Agent token** → copiar → colar em `agent\.env`, na linha
`TEAM_AGENT_TOKEN=`.

## 4. Agente e widget (duas janelas)

```
cd agent
..\.venv\Scripts\python -m team_agent
```

```
cd widget
..\.venv\Scripts\python -m team_widget
```

Fechar a janela do widget manda-o para a barra de tarefas; o agente continua a trabalhar.

## Nota (2 out)

O widget passou a ser em Qt (PySide6): ao voltar a correr o ARRANCAR.bat as dependências novas
são instaladas sozinhas (~200 MB da primeira vez).

As passwords do painel são as de origem (owner-change-me, mark-change-me, david-change-me),
porque a base de dados foi criada antes de o .env ser lido. Nada foi apagado.
