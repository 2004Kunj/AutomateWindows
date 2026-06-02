# Start SignalFlow (stops any old server on port 5000 first)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$on5000 = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if ($on5000) {
    Write-Host "Stopping previous server on port 5000..."
    $on5000 | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

& .\.venv\Scripts\pip.exe install -q -r requirements.txt
Write-Host ""
Write-Host "Open http://127.0.0.1:5000 in your browser"
Write-Host ""
& .\.venv\Scripts\python.exe server.py
