[CmdletBinding()]
param(
  [ValidateSet('quality', 'web-acceptance', 'all')]
  [string]$Job = 'all'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$candidateCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$parityWorktree = Join-Path ([System.IO.Path]::GetTempPath()) "baseer-erp-ci-parity-$($candidateCommit.Substring(0, 12))"

# act executes the repository's actual GitHub workflow in a Linux container.
# It receives a dedicated LF worktree from the committed candidate, never the
# Windows checkout. This avoids CRLF false positives and protects node_modules.
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

if (Test-Path -LiteralPath $parityWorktree) {
  & git -C $repositoryRoot worktree remove --force $parityWorktree
}

& git -C $repositoryRoot -c core.autocrlf=false worktree add --detach $parityWorktree $candidateCommit
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Push-Location $parityWorktree
try {
  foreach ($selectedJob in $jobs) {
    Write-Host "Running GitHub workflow parity job: $selectedJob" -ForegroundColor Cyan
    & $actPath push `
      --workflows $workflowPath `
      --job $selectedJob `
      --platform 'ubuntu-latest=ghcr.io/catthehacker/ubuntu:full-latest' `
      --container-architecture 'linux/amd64' `
      --no-recurse
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
} finally {
  Pop-Location
  & git -C $repositoryRoot worktree remove --force $parityWorktree
}
