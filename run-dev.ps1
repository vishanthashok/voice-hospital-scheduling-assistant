# Start ML (FastAPI) + web (Express/Vite). Double-click run-dev.cmd or: powershell -File .\run-dev.ps1
# Args: [webPort] [mlPort] - defaults 3000 and 8000
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$WebPort = if ($args[0]) { $args[0] } else { "3000" }
$MlPort = if ($args[1]) { $args[1] } else { "8000" }

$mlDir = Join-Path $Root "ml-backend"
if (-not (Test-Path $mlDir)) {
    Write-Error "ml-backend not found under $Root"
    exit 1
}

$tsxCmd = Join-Path $Root "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $tsxCmd)) {
    Write-Host "Missing node_modules. From this folder run once: npm install" -ForegroundColor Yellow
    exit 1
}

# Free ML port if a stale uvicorn/python is still listening (avoids WinError 10048)
$mlPortInt = [int]$MlPort
$listeners = Get-NetTCPConnection -LocalPort $mlPortInt -State Listen -ErrorAction SilentlyContinue
foreach ($c in $listeners) {
    $owningPid = $c.OwningProcess
    if ($owningPid) {
        Write-Host "Stopping PID $owningPid so port $MlPort is free (old ML server)..." -ForegroundColor Yellow
        Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 400

Write-Host "Opening ML backend in a new window -> http://127.0.0.1:$MlPort" -ForegroundColor Cyan
$mlOneLiner = "Set-Location '$mlDir'; `$env:PYTHONUNBUFFERED='1'; python -m uvicorn main:app --host 127.0.0.1 --port $MlPort"
Start-Process powershell.exe -ArgumentList @("-NoExit", "-NoProfile", "-Command", $mlOneLiner)

$healthUrl = "http://127.0.0.1:$MlPort/health"
$deadline = (Get-Date).AddSeconds(25)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 350
}
if (-not $ok) {
    Write-Warning "ML /health not ready yet - check the ML window. Starting web anyway..."
}

Set-Location $Root
$env:PORT = $WebPort
$env:ML_BACKEND_URL = "http://127.0.0.1:$MlPort"
Write-Host "Web app -> http://127.0.0.1:$WebPort (Ctrl+C stops web only; close ML window separately)" -ForegroundColor Green
& $tsxCmd "server.ts"
