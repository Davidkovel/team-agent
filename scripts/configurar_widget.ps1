# Liga o widget Agente AMG ao Hub partilhado. Corre uma vez em cada PC.
#   Kovel (host):    .\configurar_widget.ps1 -Key <chave> -User Kovel
#   Marco / David:   .\configurar_widget.ps1 -Key <chave> -User Marco -HostIp <IP Radmin do Kovel>
param([Parameter(Mandatory)][string]$Key, [Parameter(Mandatory)][string]$User, [string]$HostIp = "")
$dir = Join-Path $env:USERPROFILE ".team-agent"
New-Item -ItemType Directory -Force $dir | Out-Null
$cfg = @{ key = $Key; user = $User }
if ($HostIp) { $cfg.hub_url = "http://${HostIp}:8000" }
$cfg | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $dir "widget.json")
Write-Host "Feito. Fecha e abre o Agente AMG." -ForegroundColor Green
if (-not $HostIp) {
    # o Hub antigo (so local, sem chave) tem de morrer para o widget o voltar a arrancar aberto a rede
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "uvicorn app.main:app" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    # so a rede Radmin (26.0.0.0/8) entra na porta 8000; a regra larga "python.exe" que o Windows cria sozinho abria-a a internet
    Disable-NetFirewallRule -DisplayName "python.exe" -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "Agente AMG Hub" -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName "Agente AMG Hub" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -RemoteAddress 26.0.0.0/8 -ErrorAction SilentlyContinue | Out-Null
    Write-Host "Host: porta 8000 aberta na firewall, so para a rede Radmin (corre como administrador). O teu IP Radmin e o que aparece na janela do Radmin VPN." -ForegroundColor Yellow
}
