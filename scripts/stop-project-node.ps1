# Stops Node processes started from this repo (dev servers, tsx watch, vitest, etc.).
# Prisma generate on Windows fails with EPERM while query_engine-windows.dll.node is loaded.

$repoRoot = Split-Path -Parent $PSScriptRoot
$repoPattern = [regex]::Escape($repoRoot)

$matches = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -match $repoPattern }

# Also stop any node.exe listening on common dev ports (catches orphans outside repo path match)
$portPids = @(3001, 3002, 5173, 5174, 5175) | ForEach-Object {
  Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
} | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique

foreach ($procId in $portPids) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
  if ($proc -and $proc.Name -eq 'node.exe') {
    $matches += $proc
  }
}

$matches = $matches | Sort-Object ProcessId -Unique

if ($matches.Count -eq 0) {
  Write-Host "No Node processes found for: $repoRoot"
  exit 0
}

Write-Host "Stopping $($matches.Count) Node process(es) for this repo..."
foreach ($proc in $matches) {
  $snippet = $proc.CommandLine
  if ($snippet.Length -gt 100) { $snippet = $snippet.Substring(0, 100) + '...' }
  Write-Host "  PID $($proc.ProcessId): $snippet"
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1
Write-Host "Done. You can restart dev servers after prisma generate completes."
