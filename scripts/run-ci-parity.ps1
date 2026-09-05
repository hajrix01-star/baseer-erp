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
$commonGitDirectory = (& git -C $repositoryRoot rev-parse --git-common-dir).Trim()
if (-not [System.IO.Path]::IsPathRooted($commonGitDirectory)) {
  $commonGitDirectory = Join-Path $repositoryRoot $commonGitDirectory
}

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
$gitDrive = $commonGitDirectory.Substring(0, 1).ToLowerInvariant()
$relativeGitPath = $commonGitDirectory.Substring(3).Replace('\', '/')
$linuxGitSource = "/mnt/$gitDrive/$relativeGitPath"
$linuxParityClone = "/tmp/$parityCloneName"

$jobs = if ($Job -eq 'all') { @('quality', 'web-acceptance') } else { @($Job) }

try {
  $workflowRelativePath = '.github/workflows/verify.yml'
  # act changes mounted test files to the runner uid. Clean as root before and
  # after the run so a failed acceptance pass cannot fill WSL /tmp with clones.
  & $wsl.Source -d Ubuntu -u root -- bash -c "rm -rf '$linuxParityClone'"
  $linuxCommand = "set -e; test -S /var/run/docker.sock; test -x ~/.local/bin/act; git clone --no-local --no-checkout '$linuxGitSource' '$linuxParityClone'; git -C '$linuxParityClone' -c core.autocrlf=false checkout --detach '$candidateCommit'; cd '$linuxParityClone';"
  foreach ($selectedJob in $jobs) {
    Write-Host "Running GitHub workflow parity job in Ubuntu: $selectedJob" -ForegroundColor Cyan
    # The only GitHub-hosted capability absent from local `act` is artifact
    # upload. Mark the parity invocation so the workflow skips that external
    # post-processing step; all build, test, and acceptance commands remain
    # the workflow's exact commands.
    $linuxCommand += " ~/.local/bin/act pull_request --workflows '$workflowRelativePath' --job '$selectedJob' --platform 'ubuntu-latest=ghcr.io/catthehacker/ubuntu:full-latest' --container-architecture 'linux/amd64' --bind --no-recurse --env BASEER_CI_PARITY=true;"
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
