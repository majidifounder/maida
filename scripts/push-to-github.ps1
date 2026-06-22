# Push to GitHub as majidifounder (fixes "Application introuvable" browser error)
# Run in PowerShell: .\scripts\push-to-github.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Write-Host "=== Push to GitHub ===" -ForegroundColor Cyan
Write-Host ""

# Avoid broken Windows browser/broker OAuth — use device code in terminal instead
$env:GCM_GITHUB_AUTHMODES = 'device'
$env:GCM_MSAUTH_USEBROKER = 'false'
$env:GCM_MSAUTH_FLOW = 'devicecode'
$env:GCM_INTERACTIVE = 'always'

git remote set-url origin "https://github.com/majidifounder/Restaurant-Resrvation-WebSite.git"

Write-Host "Starting push..." -ForegroundColor Cyan
Write-Host "You will see a URL and a code in this window." -ForegroundColor Yellow
Write-Host "Open the URL in ANY browser, sign in as majidifounder, paste the code." -ForegroundColor Yellow
Write-Host ""

git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Success! https://github.com/majidifounder/Restaurant-Resrvation-WebSite" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Device login failed. Using token fallback..." -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Open: https://github.com/settings/tokens/new?scopes=repo" -ForegroundColor White
Write-Host "2. Generate token (classic), copy it" -ForegroundColor White
Write-Host "3. Run: git push -u origin main" -ForegroundColor White
Write-Host "   Username: majidifounder" -ForegroundColor White
Write-Host "   Password: paste the token (not your GitHub password)" -ForegroundColor White
Write-Host ""

$env:GCM_GITHUB_AUTHMODES = 'pat'
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Success! https://github.com/majidifounder/Restaurant-Resrvation-WebSite" -ForegroundColor Green
}
