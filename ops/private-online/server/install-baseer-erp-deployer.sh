#!/usr/bin/env bash
# One-time root bootstrap. It installs a forced SSH command and never copies
# the real Baseer environment out of Hostinger.
set -Eeuo pipefail

die() { printf 'BASEER DEPLOY INSTALL FAILED: %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die 'Run as root.'
[[ $# -eq 2 && "$1" == '--public-key-file' ]] || die 'Usage: install-baseer-erp-deployer.sh --public-key-file <path>'
readonly public_key_file="$2"
readonly deploy_user='baseer-erp-deploy'
readonly source_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$public_key_file" ]] || die 'Public key file is missing.'
[[ -f "$source_directory/baseer-erp-deploy-ssh" ]] || die 'Forced-command script is missing.'
[[ -f "$source_directory/baseer-erp-deploy-release" ]] || die 'Root deployer script is missing.'
bash -n "$source_directory/baseer-erp-deploy-ssh" "$source_directory/baseer-erp-deploy-release"

id -u "$deploy_user" >/dev/null 2>&1 || useradd --create-home --home-dir "/home/${deploy_user}" --shell /usr/sbin/nologin "$deploy_user"
install -d -o "$deploy_user" -g "$deploy_user" -m 0700 "/home/${deploy_user}/.ssh"
{
  printf 'restrict,command="/usr/local/sbin/baseer-erp-deploy-ssh" '
  tr -d '\r\n' <"$public_key_file"
  printf '\n'
} >"/home/${deploy_user}/.ssh/authorized_keys"
chown "$deploy_user:$deploy_user" "/home/${deploy_user}/.ssh/authorized_keys"
chmod 0600 "/home/${deploy_user}/.ssh/authorized_keys"

install -o root -g root -m 0755 "$source_directory/baseer-erp-deploy-ssh" /usr/local/sbin/baseer-erp-deploy-ssh
install -o root -g root -m 0755 "$source_directory/baseer-erp-deploy-release" /usr/local/sbin/baseer-erp-deploy-release
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/baseer-erp-deploy-release *\n' "$deploy_user" >/etc/sudoers.d/baseer-erp-deploy
chmod 0440 /etc/sudoers.d/baseer-erp-deploy
visudo -cf /etc/sudoers.d/baseer-erp-deploy >/dev/null
printf 'BASEER DEPLOY INSTALL PASSED: restricted user %s is ready.\n' "$deploy_user"
