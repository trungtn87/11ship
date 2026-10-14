#!/usr/bin/env bash
# run-roles-database.sh — runs 01-roles-database.sql as the PostgreSQL superuser with the two role passwords read from root-owned
# secret files (M00-VPS-01). The only supported way to run the preparation on the VPS.
#
#   sudo ./run-roles-database.sh [secrets-dir]       # default /root/ship11-secrets (root:root 700; migrator.pw, app.pw: root:root 600)
#
# Root reads and validates the files; the values travel to `psql` (OS user postgres, peer authentication) through a pipe built
# with shell builtins only. They are never in argv, a file, the shell history or a log, and this script prints no value.
# Any refusal happens before psql starts; psql errors are non-zero too (ON_ERROR_STOP), and nothing is created before the SQL
# has validated both passwords. Exit status: 0 done, 1 refused here, other = psql's own (3 = an SQL error such as "already exists").
set -euo pipefail
umask 077

refuse() {
  echo "refused: $1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || refuse "run as root (sudo): root reads the secret files; the postgres OS user cannot"
dir="${1:-/root/ship11-secrets}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sql="$here/01-roles-database.sql"
[ -r "$sql" ] || refuse "01-roles-database.sql not found next to this script"
[ -d "$dir" ] && [ ! -L "$dir" ] || refuse "the secrets directory is missing or is a link"
[ "$(stat -c '%a %u' "$dir")" = "700 0" ] || refuse "the secrets directory must be owned by root with mode 700"
command -v psql >/dev/null || refuse "psql is not installed"
command -v runuser >/dev/null || refuse "runuser is not available"
id postgres >/dev/null 2>&1 || refuse "the OS user postgres does not exist"

secret=""
read_secret() {
  local file="$dir/$1" value
  { [ -f "$file" ] && [ ! -L "$file" ]; } || refuse "$1 is missing or is not a regular file"
  [ "$(stat -c '%a %u' "$file")" = "600 0" ] || refuse "$1 must be owned by root with mode 600"
  value="$(<"$file")" || refuse "$1 cannot be read"
  [[ "$value" =~ ^[0-9a-f]{32,128}$ ]] || refuse "$1 must hold 32..128 lower-case hex characters (openssl rand -hex 24)"
  secret="$value"
}

read_secret migrator.pw
migrator="$secret"
read_secret app.pw
app="$secret"
secret=""
[ "$migrator" != "$app" ] || refuse "migrator.pw and app.pw must differ"

# printf is a builtin: the values do not appear in any process's argument list. The pipe ends when psql ends.
{
  printf '\\set ON_ERROR_STOP on\n'
  printf '\\set migrator_password %s\n' "'$migrator'"
  printf '\\set app_password %s\n' "'$app'"
  cat "$sql"
} | runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres
