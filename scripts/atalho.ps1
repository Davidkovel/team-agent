# Cria o atalho "Agente AMG" no ambiente de trabalho e no menu Iniciar: um duplo clique abre o widget (e o Hub)
# sem consola, como uma app. O iniciar.ps1 chama isto, por isso basta correr o iniciar.ps1 uma vez em cada PC.
#   .\scripts\atalho.ps1
$repo = Split-Path $PSScriptRoot -Parent
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    $link = $shell.CreateShortcut((Join-Path $folder "Agente AMG.lnk"))
    $link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $repo 'scripts\iniciar.ps1')`""
    $link.WorkingDirectory = $repo
    $link.IconLocation = Join-Path $repo "widget\team_widget\assets\app.ico"
    $link.WindowStyle = 7   # minimizado: a consola do PowerShell nao salta para a frente
    $link.Description = "Agente AMG"
    $link.Save()
    # "Empresa AMG": o widget abre logo na central de controlo dos agentes (se ja estiver aberto, so muda de pagina)
    $link = $shell.CreateShortcut((Join-Path $folder "Empresa AMG.lnk"))
    $link.TargetPath = Join-Path $repo ".venv\Scripts\pythonw.exe"
    $link.Arguments = "-m team_widget --open /empresa"
    $link.WorkingDirectory = Join-Path $repo "widget"
    $link.IconLocation = Join-Path $repo "widget\team_widget\assets\app.ico"
    $link.Description = "Empresa AMG: a central de controlo dos agentes"
    $link.Save()
}
