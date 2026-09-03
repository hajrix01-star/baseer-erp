[CmdletBinding()]
param(
  [ValidateSet('quality', 'web-acceptance', 'all')]
  [string]$Job = 'all'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$candidateCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$parityClone = Join-Path ([System.IO.Path]::GetTempPath()) "baseer-erp-ci-parity-$($candidateCommit.Substring(0, 12))"

# act executes the repository's actual GitHub workflow in a Linux container.
# It receives a dedicated LF clone at the committed candidate, never the Windows
# checkout. A standalone clone keeps .git visible to Linux, avoids CRLF false
# positives, and protects the developer checkout and its node_modules.
$actCommand = Get-Command act -ErrorAction SilentlyContinue
if ($null -eq $actCommand) {
  $wingetAct = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\nektos.act_Microsoft.Winget.Source_8wekyb3d8bbwe\act.exe'
  if (-not (Test-Path -LiteralPath $wingetAct)) {
    throw 'act is required. Install it with: winget install --id nektos.act --exact --source winget'
  }
  $actPath = $wingetAct
} else {
  $actPath = $actCommand.Source
}

$workflowPath = Join-Path $repositoryRoot '.github\workflows\verify.yml'
$jobs = if ($Job -eq 'all') { @('quality', 'web-acceptance') } else { @($Job) }

if (Test-Path -LiteralPath $parityClone) {
  Remove-Item -LiteralPath $parityClone -Recurse -Force
}

& git -C $repositoryRoot -c core.autocrlf=false clone --no-local --no-checkout $repositoryRoot $parityClone
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& git -C $parityClone -c core.autocrlf=false checkout --detach $candidateCommit
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $parityClone -Recurse -Force
  exit $LASTEXITCODE
}

Push-Location $parityClone
try {
  foreach ($selectedJob in $jobs) {
    Write-Host "Running GitHub workflow parity job: $selectedJob" -ForegroundColor Cyan
    & $actPath push `
      --workflows $workflowPath `
      --job $selectedJob `
      --platform 'ubuntu-latest=ghcr.io/catthehacker/ubuntu:full-latest' `
      --container-architecture 'linux/amd64' `
      --bind `
      --no-recurse
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
} finally {
  Pop-Location
  Remove-Item -LiteralPath $parityClone -Recurse -Force
}
