# Start jwt-service, hackathon-service, and gateway from repo root
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Team-2 dev startup"
Write-Host "Root: $root"
Write-Host ""
Write-Host "Opening jwt-service (port 4004) in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\jwt-service'; npm run dev"

Start-Sleep -Seconds 2

Write-Host "Opening hackathon-service (port 4001) in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\services\hackathon-service'; npm run dev"

Start-Sleep -Seconds 2

Write-Host "Opening gateway (port 4000) in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\gateway'; npm run dev"

Write-Host ""
Write-Host "When all three are running, test:"
Write-Host "  curl.exe http://localhost:4000/health/ready"
Write-Host "  curl.exe -X POST http://localhost:4000/api/auth/login -H ""content-type: application/json"" -d ""{\""email\"":\""viewer@local\"",\""password\"":\""change-me-viewer\""}"""
