# Abre o Agente AMG neste PC. Serve depois de um git clone ou de um git pull: na primeira vez cria o .venv,
# instala o que faltar e abre o widget sem janela de consola (fechar o PowerShell nao o fecha).
#   .\scripts\iniciar.ps1
# Antes, uma vez em cada PC: .\scripts\configurar_widget.ps1 (chave da equipa, nome e, fora do host, o IP Radmin do host).
$repo = Split-Path $PSScriptRoot -Parent
$venv = Join-Path $repo ".venv"
$py = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Primeira vez: a criar o .venv..." -ForegroundColor Yellow
    python -m venv $venv
    if (-not (Test-Path $py)) { Write-Host "Falta o Python 3.11+ (python.org) no PATH." -ForegroundColor Red; exit 1 }
}
# o widget e o Hub que ele arranca usam este .venv; o pip so demora quando ha dependencias novas
& $py -m pip install -q --disable-pip-version-check -r (Join-Path $repo "backend\requirements.txt") -r (Join-Path $repo "widget\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "O pip falhou; ve o erro acima." -ForegroundColor Red; exit 1 }
# cada PC tem o seu Hub e eles sincronizam pela rede Radmin: a porta 8000 so abre para ela (so funciona como administrador; sem isso sincroniza na mesma atraves de quem a tem aberta)
if (-not (Get-NetFirewallRule -DisplayName "Agente AMG Hub" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Agente AMG Hub" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -RemoteAddress 26.0.0.0/8 -ErrorAction SilentlyContinue | Out-Null
}
# um widget antigo ficaria com o codigo de antes do git pull
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "-m team_widget" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process (Join-Path $venv "Scripts\pythonw.exe") -ArgumentList "-m", "team_widget" -WorkingDirectory (Join-Path $repo "widget")
Write-Host "Agente AMG aberto." -ForegroundColor Green
