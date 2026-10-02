# Team Agent — instala e arranca tudo nesta máquina.
# Abre-se com o ARRANCAR.bat (duplo clique). Pode correr-se as vezes que forem precisas.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "`n== Team Agent ==`n" -ForegroundColor Cyan

# 1. Python
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $py)) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Host "Python não encontrado. Instala com: winget install Python.Python.3.12" -ForegroundColor Red; Read-Host "Enter para fechar"; exit 1 }

# 2. Ambiente e dependências (só da primeira vez demora)
if (-not (Test-Path ".venv")) { Write-Host "A preparar o ambiente..." ; & $py -m venv .venv }
Write-Host "A instalar as dependências (pode demorar um pouco na primeira vez)..."
& ".\.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install --quiet -r backend\requirements.txt -r agent\requirements.txt -r widget\requirements.txt

# 3. Servidor + painel (SQLite, sem Docker)
# O backend lê o .env da pasta onde corre (backend\), não o da raiz: por isso copia-se para lá.
Copy-Item .env backend\.env -Force
$jwt = ((Get-Content .env | Where-Object { $_ -like 'JWT_SECRET=*' }) -split '=', 2)[1]
$env:DATABASE_URL = "sqlite+aiosqlite:///./dev.db"
$env:REDIS_URL = ""
$env:JWT_SECRET = $jwt
Write-Host "A arrancar o servidor em http://localhost:8000 ..."
Start-Process -FilePath "$root\.venv\Scripts\python.exe" -ArgumentList "-m","uvicorn","app.main:app","--port","8000" -WorkingDirectory "$root\backend"
Start-Sleep -Seconds 8
Start-Process "http://localhost:8000"

# 4. Agente — só arranca depois de o token estar preenchido em agent\.env
$token = ((Get-Content agent\.env | Where-Object { $_ -like 'TEAM_AGENT_TOKEN=*' }) -split '=', 2)[1]
if ($token) {
  Write-Host "A arrancar o agente..."
  Start-Process -FilePath "$root\.venv\Scripts\python.exe" -ArgumentList "-m","team_agent" -WorkingDirectory "$root\agent"
} else {
  Write-Host "`nFALTA O TOKEN: no painel que acabou de abrir, entra como 'david' (password no ficheiro .env)," -ForegroundColor Yellow
  Write-Host "carrega em 'Agent token', copia, e cola em agent\.env na linha TEAM_AGENT_TOKEN=" -ForegroundColor Yellow
  Write-Host "Depois volta a abrir este ficheiro e o agente arranca.`n" -ForegroundColor Yellow
}

# 5. Widget
Write-Host "A abrir o widget..."
Start-Process -FilePath "$root\.venv\Scripts\python.exe" -ArgumentList "-m","team_widget" -WorkingDirectory "$root\widget"

Write-Host "`nPronto. O painel está em http://localhost:8000 e o widget abriu." -ForegroundColor Green
Read-Host "Enter para fechar esta janela (o servidor e o widget continuam a correr)"
