# Stop repo Node processes (they lock query_engine-windows.dll.node), then prisma generate.

& "$PSScriptRoot\stop-project-node.ps1"
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  pnpm db:generate
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
