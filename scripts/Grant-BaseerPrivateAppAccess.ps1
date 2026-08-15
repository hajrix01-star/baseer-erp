[CmdletBinding()]
param(
  [string]$EnvironmentFile = 'ops/private-online/.env.private-online',
  [string]$ComposeFile = 'docker-compose.private-online.yml'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Environment file was not found: $EnvironmentFile"
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
  throw "Compose file was not found: $ComposeFile"
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
  if ($line -match '^\s*([A-Z0-9_]+)=(.+?)\s*$') {
    $settings[$matches[1]] = $matches[2]
  }
}

foreach ($required in @('BASEER_DB_NAME', 'BASEER_DB_APP_USER')) {
  if (-not $settings.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($settings[$required])) {
    throw "Missing $required in $EnvironmentFile"
  }
}

$grantSql = @'
GRANT USAGE ON SCHEMA public TO :"baseer_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"baseer_app_user";
REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM :"baseer_app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"baseer_app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"baseer_app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"baseer_app_user";
'@

$composeArguments = @('--env-file', $EnvironmentFile, '-f', $ComposeFile, 'exec', '-T', 'postgres', 'psql', '--set=ON_ERROR_STOP=1', "--set=baseer_app_user=$($settings['BASEER_DB_APP_USER'])", '--username', 'postgres', '--dbname', $settings['BASEER_DB_NAME'])
$grantSql | & docker compose @composeArguments
if ($LASTEXITCODE -ne 0) {
  throw 'Database application-role grants failed.'
}

Write-Output 'BASEER ERP application database role privileges have been applied.'
