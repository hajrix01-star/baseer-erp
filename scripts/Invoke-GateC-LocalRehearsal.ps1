[CmdletBinding()]
param(
  [string]$SourceContainer = 'baseer-erp-postgres',
  [string]$EnvironmentFile = 'apps/api/.env.baseer-test',
  [string]$ReceiptDirectory = '.rehearsal/gate-c',
  [switch]$KeepSyntheticBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-EnvironmentValue {
  param([string]$Name, [string]$DefaultValue)

  $line = Get-Content -LiteralPath $EnvironmentFile | Where-Object {
    $_ -match "^\s*$([regex]::Escape($Name))=(.+?)\s*$"
  } | Select-Object -First 1
  if ($line -and $line -match '^[^=]+=(.+)$') {
    return $matches[1].Trim().Trim('"').Trim("'")
  }
  return $DefaultValue
}

function Invoke-Docker {
  param([string[]]$Arguments)

  $output = & docker @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Docker command failed: docker $($Arguments -join ' ')`n$output"
  }
  return $output
}

function Invoke-PostgresSql {
  param(
    [string]$Container,
    [string]$User,
    [string]$Database,
    [string]$Sql,
    [string[]]$PsqlArguments = @(),
    [string]$Password
  )

  $dockerArguments = @('exec', '-i')
  if ($Password) {
    $dockerArguments += @('--env', "PGPASSWORD=$Password")
  }
  $dockerArguments += @($Container, 'psql', '--set=ON_ERROR_STOP=1', '--username', $User, '--dbname', $Database)
  $dockerArguments += $PsqlArguments
  $output = $Sql | & docker @dockerArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL command failed in $Container.`n$output"
  }
  return $output
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Test environment file was not found: $EnvironmentFile"
}

$testDatabase = Get-EnvironmentValue -Name 'BASEER_TEST_DB_NAME' -DefaultValue 'baseer_erp_test'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$token = [guid]::NewGuid().ToString('N').Substring(0, 12)
$restoreContainer = "baseer-erp-gate-c-$token"
$restoreDatabase = "baseer_gate_c_$token"
$restorePassword = "GateC-$token-Only"
$appRole = "baseer_rehearsal_$token"
$appPassword = "GateC-App-$token-Only"
$sourceTemporaryDump = "/tmp/baseer-gate-c-$token.dump"
$receiptRoot = [System.IO.Path]::GetFullPath($ReceiptDirectory)
$backupPath = Join-Path $receiptRoot "synthetic-backup-$stamp.dump"
$receiptPath = Join-Path $receiptRoot "receipt-$stamp.json"
$containerStarted = $false

$summarySql = @'
SELECT json_build_object(
  'tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
  'tenants', (SELECT count(*) FROM "Tenant"),
  'users', (SELECT count(*) FROM "User"),
  'companies', (SELECT count(*) FROM "Company"),
  'sessions', (SELECT count(*) FROM "AppSession"),
  'auditEvents', (SELECT count(*) FROM "AuditEvent"),
  'idempotencyReceipts', (SELECT count(*) FROM "IdempotencyReceipt"),
  'documentSerialCounters', (SELECT count(*) FROM "DocumentSerialCounter"),
  'fileMetadata', (SELECT count(*) FROM "FileMetadata")
);
'@

try {
  New-Item -ItemType Directory -Path $receiptRoot -Force | Out-Null

  $sourceSummary = (Invoke-PostgresSql -Container $SourceContainer -User 'postgres' -Database $testDatabase -Sql $summarySql -PsqlArguments @('--tuples-only', '--no-align') | Select-Object -Last 1).Trim()
  if (-not $sourceSummary) {
    throw 'The synthetic source summary is empty.'
  }

  Invoke-Docker @('exec', $SourceContainer, 'pg_dump', '--username', 'postgres', '--dbname', $testDatabase, '--format=custom', '--no-owner', '--no-privileges', "--file=$sourceTemporaryDump") | Out-Null
  Invoke-Docker @('cp', "${SourceContainer}:$sourceTemporaryDump", $backupPath) | Out-Null
  Invoke-Docker @('exec', $SourceContainer, 'rm', '-f', $sourceTemporaryDump) | Out-Null

  Invoke-Docker @('run', '--detach', '--rm', '--name', $restoreContainer, '--network', 'none', '--env', "POSTGRES_DB=$restoreDatabase", '--env', 'POSTGRES_USER=postgres', '--env', "POSTGRES_PASSWORD=$restorePassword", 'postgres:16-alpine') | Out-Null
  $containerStarted = $true

  $ready = $false
  foreach ($attempt in 1..30) {
    $status = & docker exec $restoreContainer pg_isready --username postgres --dbname $restoreDatabase 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'The isolated restore database did not become ready in time.'
  }

  Invoke-Docker @('cp', $backupPath, "${restoreContainer}:/tmp/rehearsal.dump") | Out-Null
  Invoke-Docker @('exec', $restoreContainer, 'pg_restore', '--username', 'postgres', '--dbname', $restoreDatabase, '--no-owner', '--no-privileges', '/tmp/rehearsal.dump') | Out-Null

  $roleSql = @'
CREATE ROLE :"baseer_app_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'baseer_app_password';
GRANT CONNECT ON DATABASE :"restore_database" TO :"baseer_app_role";
GRANT USAGE ON SCHEMA public TO :"baseer_app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"baseer_app_role";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"baseer_app_role";
'@
  Invoke-PostgresSql -Container $restoreContainer -User 'postgres' -Database $restoreDatabase -Sql $roleSql -PsqlArguments @("--set=baseer_app_role=$appRole", "--set=baseer_app_password=$appPassword", "--set=restore_database=$restoreDatabase") | Out-Null

  $restoredSummary = (Invoke-PostgresSql -Container $restoreContainer -User 'postgres' -Database $restoreDatabase -Sql $summarySql -PsqlArguments @('--tuples-only', '--no-align') | Select-Object -Last 1).Trim()
  if ($sourceSummary -ne $restoredSummary) {
    throw "Restored summary differs from source. Source: $sourceSummary Restored: $restoredSummary"
  }

  $restoredRole = (Invoke-PostgresSql -Container $restoreContainer -User $appRole -Database $restoreDatabase -Password $appPassword -Sql 'SELECT current_user;' -PsqlArguments @('--tuples-only', '--no-align') | Select-Object -Last 1).Trim()
  if ($restoredRole -ne $appRole) {
    throw 'The restricted application role could not authenticate to the isolated restore database.'
  }

  $hash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt = [ordered]@{
    rehearsal = 'gate-c-local-synthetic-backup-restore'
    completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    sourceContainer = $SourceContainer
    sourceDatabase = $testDatabase
    restoreNetwork = 'none'
    restoredDatabase = $restoreDatabase
    backupSha256 = $hash
    sourceAndRestoreSummary = ($sourceSummary | ConvertFrom-Json)
    restrictedRoleAuthenticated = $true
    syntheticBackupRetained = [bool]$KeepSyntheticBackup
    result = 'passed'
  }
  $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  Write-Output "Gate C local synthetic rehearsal passed. Receipt: $receiptPath"
}
finally {
  & docker exec $SourceContainer rm -f $sourceTemporaryDump 2>$null | Out-Null
  if ($containerStarted) {
    & docker rm --force $restoreContainer 2>$null | Out-Null
  }
  if ((-not $KeepSyntheticBackup) -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    Remove-Item -LiteralPath $backupPath -Force
  }
}
