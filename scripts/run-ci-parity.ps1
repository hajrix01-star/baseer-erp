[CmdletBinding()]
param(
  [ValidateSet('quality', 'web-acceptance', 'all')]
  [string]$Job = 'all',
  # Keep the isolated Linux clone only when diagnosing a failed acceptance
  # run. This preserves Playwright traces, screenshots, and diffs for review.
  [switch]$KeepArtifacts
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$candidateCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$parityCloneName = "baseer-erp-ci-parity-$($candidateCommit.Substring(0, 12))"

# act must run from the Ubuntu WSL integration, not the Windows Docker named
# pipe. The quality job itself builds and runs Docker images; Windows act cannot
# pass that inner Docker socket into its Linux job container. Ubuntu exposes the
# real /var/run/docker.sock, matching the GitHub runner contract.
$wsl = Get-Command wsl -ErrorAction SilentlyContinue
if ($null -eq $wsl) {
  throw 'WSL Ubuntu with Docker integration is required for CI parity. Install or enable WSL, then run Docker Desktop > Settings > Resources > WSL Integration.'
}

$drive = $repositoryRoot.Substring(0, 1).ToLowerInvariant()
$relativeRepositoryPath = $repositoryRoot.Substring(3).Replace('\', '/')
$linuxRepositoryRoot = "/mnt/$drive/$relativeRepositoryPath"
$linuxParityClone = "/tmp/$parityCloneName"

$jobs = if ($Job -eq 'all') { @('quality', 'web-acceptance') } else { @($Job) }

try {
  $workflowRelativePath = '.github/workflows/verify.yml'
  # act changes mounted test files to the runner uid. Clean as root before and
  # after the run so a failed acceptance pass cannot fill WSL /tmp with clones.
  & $wsl.Source -d Ubuntu -u root -- bash -c "rm -rf '$linuxParityClone'"
  $linuxCommand = "set -e; test -S /var/run/docker.sock; test -x ~/.local/bin/act; git -C '$linuxRepositoryRoot' -c core.autocrlf=false clone --no-local --no-checkout '$linuxRepositoryRoot' '$linuxParityClone'; git -C '$linuxParityClone' -c core.autocrlf=false checkout --detach '$candidateCommit'; cd '$linuxParityClone';"
  foreach ($selectedJob in $jobs) {
    Write-Host "Running GitHub workflow parity job in Ubuntu: $selectedJob" -ForegroundColor Cyan
    $linuxCommand += " ~/.local/bin/act push --workflows '$workflowRelativePath' --job '$selectedJob' --platform 'ubuntu-latest=ghcr.io/catthehacker/ubuntu:full-latest' --container-architecture 'linux/amd64' --bind --no-recurse;"
  }
  & $wsl.Source -d Ubuntu -- bash -c $linuxCommand
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  if (-not $KeepArtifacts) {
    & $wsl.Source -d Ubuntu -u root -- bash -c "rm -rf '$linuxParityClone'"
  } else {
    Write-Host "Retained Linux CI evidence at $linuxParityClone" -ForegroundColor Yellow
  }
}
