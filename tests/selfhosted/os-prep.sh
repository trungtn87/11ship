#!/usr/bin/env bash
# CI only (GitHub Actions, Ubuntu 24.04, disposable runner): the runbook's OS-level preparation on a real PostgreSQL 17 cluster
# with two real OS users (root, postgres), the real directory/file modes, peer authentication, TLS 1.3 and SCRAM over TCP
# (review F1 and F3 of PR #70). Run as:  sudo -E bash tests/selfhosted/os-prep.sh   from the repository root.
# It refuses to run anywhere else: it installs certificates, replaces pg_hba.conf and creates roles.
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = "true" ] || { echo "refused: this test only runs in GitHub Actions" >&2; exit 1; }
[ "${SELFHOSTED_OS_PREP_CONFIRM:-}" = "disposable-ci-runner" ] || { echo "refused: set SELFHOSTED_OS_PREP_CONFIRM=disposable-ci-runner" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "refused: run with sudo" >&2; exit 1; }

repo="$PWD"
sel="$repo/ops/selfhosted"
secrets=/root/ship11-secrets
pass=0
step() { echo; echo "== $*"; }
ok() { pass=$((pass + 1)); echo "ok - $*"; }
die() { echo "NOT OK - $*" >&2; exit 1; }
pg() { runuser -u postgres -- psql -X -Atq -d postgres -c "$1"; }
roles_count() { pg "select count(*) from pg_roles where rolname like 'ship11\_%'"; }
expect_fail_clean() { # description, then command...; the command must fail and create nothing
  local what="$1"; shift
  if "$@" >/tmp/os-prep.out 2>&1; then die "$what: expected a refusal"; fi
  [ "$(roles_count)" = "0" ] || die "$what: a role exists after a refusal"
  [ "$(pg "select count(*) from pg_database where datname='ship11_staging'")" = "0" ] || die "$what: the database exists after a refusal"
  if grep -Eq '[0-9a-f]{32}' /tmp/os-prep.out; then die "$what: output contains a secret-looking value"; fi
  ok "$what"
}

step "PostgreSQL 17 cluster present, running as the OS user postgres"
pg_lsclusters
systemctl is-active postgresql@17-main >/dev/null || pg_ctlcluster 17 main start
pg_isready -h localhost >/dev/null

step "runbook 2: CA and server certificate (make-pki.sh new), install as in the runbook"
"$sel/make-pki.sh" new /root/ship11-pki >/dev/null
install -d -o postgres -g postgres -m 750 /etc/postgresql/17/main/tls
install -o postgres -g postgres -m 644 /root/ship11-pki/server.crt /etc/postgresql/17/main/tls/server.crt
install -o postgres -g postgres -m 600 /root/ship11-pki/server.key /etc/postgresql/17/main/tls/server.key
install -d -m 755 /etc/11ship
install -m 644 /root/ship11-pki/ca.crt /etc/11ship/db-ca.crt

step "runbook 3: pg_hba.conf and conf.d/ship11.conf from the repository, restart"
cp /etc/postgresql/17/main/pg_hba.conf /root/pg_hba.conf.orig
install -d -m 755 /etc/postgresql/17/main/conf.d
install -m 644 "$sel/postgresql-ship11.conf" /etc/postgresql/17/main/conf.d/ship11.conf
install -o postgres -g postgres -m 640 "$sel/pg_hba.conf" /etc/postgresql/17/main/pg_hba.conf
systemctl restart postgresql@17-main
for _ in $(seq 1 30); do pg_isready -h localhost >/dev/null 2>&1 && break; sleep 1; done
[ "$(pg 'show ssl')" = "on" ] && [ "$(pg 'show ssl_min_protocol_version')" = "TLSv1.3" ] || die "ssl settings"
[ "$(pg "select count(*) from pg_hba_file_rules where error is not null")" = "0" ] || die "pg_hba errors"
ok "TLS 1.3 on, pg_hba valid, peer authentication for postgres"

step "runbook 4: secrets as root (700 dir, 600 files, openssl rand -hex 24)"
install -d -m 700 "$secrets"
( umask 077; openssl rand -hex 24 > "$secrets/migrator.pw"; openssl rand -hex 24 > "$secrets/app.pw" )
[ "$(stat -c '%a %u' "$secrets")" = "700 0" ] && [ "$(stat -c '%a %u' "$secrets/app.pw")" = "600 0" ] || die "modes"

step "negative control: the OLD procedure cannot work (postgres cannot read root's secrets)"
if runuser -u postgres -- cat "$secrets/app.pw" >/dev/null 2>&1; then die "postgres can read the root-only secret file"; fi
ok "the postgres OS user cannot read $secrets (so a backtick inside psql could not either)"
# The SQL file used directly, without the variables, must refuse with a non-zero exit before creating anything.
expect_fail_clean "SQL run without the variables is refused (non-zero) and creates nothing" \
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres -f "$sel/01-roles-database.sql"
expect_fail_clean "an EMPTY variable is refused (non-zero) and creates nothing" \
  bash -c "{ printf '\\\\set migrator_password\n\\\\set app_password %s\n' \"'\$(openssl rand -hex 24)'\"; cat '$sel/01-roles-database.sql'; } | runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres"

step "wrapper refusals: every one is non-zero, prints no value, and creates nothing"
cp -p "$secrets/app.pw" /root/app.pw.keep
: > "$secrets/app.pw";                                    expect_fail_clean "empty file" "$sel/run-roles-database.sh"
printf 'abc\n' > "$secrets/app.pw";                        expect_fail_clean "too short" "$sel/run-roles-database.sh"
printf 'ABCDEF%.0s' 1 2 3 4 5 6 > "$secrets/app.pw";      expect_fail_clean "upper case / not hex" "$sel/run-roles-database.sh"
cp "$secrets/migrator.pw" "$secrets/app.pw";             expect_fail_clean "identical passwords" "$sel/run-roles-database.sh"
cp /root/app.pw.keep "$secrets/app.pw"; chmod 644 "$secrets/app.pw"; expect_fail_clean "file mode 644" "$sel/run-roles-database.sh"
chmod 600 "$secrets/app.pw"; mv "$secrets/app.pw" /root/app.pw.moved; expect_fail_clean "missing file" "$sel/run-roles-database.sh"
mv /root/app.pw.moved "$secrets/app.pw"; chmod 755 "$secrets"; expect_fail_clean "directory mode 755" "$sel/run-roles-database.sh"
chmod 700 "$secrets"
expect_fail_clean "not root (as the postgres user)" runuser -u postgres -- "$sel/run-roles-database.sh" "$secrets"
cmp -s /root/app.pw.keep "$secrets/app.pw" || die "app.pw changed"
rm -f /root/app.pw.keep

step "the real run: exit 0, roles and database exist, no password in the PostgreSQL log"
"$sel/run-roles-database.sh" | tee /tmp/os-prep.real
grep -q 'ship11_staging' /tmp/os-prep.real && grep -Eq '\| +2 +\|' /tmp/os-prep.real || die "summary"
[ "$(roles_count)" = "2" ] || die "roles"
ok "wrapper run created both roles, the database and schema app"
if grep -rqF -e "$(cat "$secrets/app.pw")" -e "$(cat "$secrets/migrator.pw")" /var/log/postgresql/ 2>/dev/null; then die "a password reached the PostgreSQL log"; fi
ok "no password in /var/log/postgresql"

step "a second run stops at CREATE ROLE (not idempotent on purpose), and changes nothing"
if "$sel/run-roles-database.sh" >/tmp/os-prep.second 2>&1; then die "second run succeeded"; fi
grep -q 'already exists' /tmp/os-prep.second || die "second run did not stop at CREATE ROLE"
if grep -rqF -e "$(cat "$secrets/app.pw")" /var/log/postgresql/ 2>/dev/null; then die "password in log after the failing statement"; fi
ok "second run refused at CREATE ROLE and the failing statement is not logged"

step "TCP + TLS 1.3 + SCRAM with the passwords from the ORIGINAL files, for both roles"
login() { # role, file, db, trust
  PGSSLROOTCERT="$4" PGPASSWORD="$(cat "$2")" psql -X -Atq "host=localhost port=5432 dbname=$3 user=$1 sslmode=verify-full" -c "select current_user || ' tls=' || (select ssl from pg_stat_ssl where pid=pg_backend_pid())"
}
# On a failure show psql's own message (it never contains the password) before stopping.
expect_login() { # role, file, trust, expected output
  local got
  got="$(login "$1" "$2" ship11_staging "$3" 2>/tmp/os-prep.login.err)" || { cat /tmp/os-prep.login.err >&2; die "login of $1 failed"; }
  [ "$got" = "$4" ] || die "login of $1 returned an unexpected identity"
}
expect_login ship11_migrator "$secrets/migrator.pw" /etc/11ship/db-ca.crt "ship11_migrator tls=t"
expect_login ship11_app "$secrets/app.pw" /etc/11ship/db-ca.crt "ship11_app tls=t"
if PGSSLROOTCERT=/etc/11ship/db-ca.crt PGPASSWORD="$(cat "$secrets/migrator.pw")" psql -X -Atq "host=localhost port=5432 dbname=ship11_staging user=ship11_app sslmode=verify-full" -c 'select 1' >/dev/null 2>&1; then die "app role accepted the migrator password"; fi
ok "both roles log in over verified TLS with SCRAM; a crossed password is refused"

step "F3 on the real server: renew-leaf keeps the CA, db-ca.crt does NOT change, login keeps working"
trust_before="$(sha256sum /etc/11ship/db-ca.crt | cut -d' ' -f1)"
install -d -m 700 /root/ca-restore
install -m 644 /root/ship11-pki/ca.crt /root/ca-restore/ca.crt
install -m 600 /root/ship11-pki/ca.key /root/ca-restore/ca.key
"$sel/make-pki.sh" renew-leaf /root/ca-restore /root/ship11-pki-renewed >/dev/null
shred -u /root/ca-restore/ca.key; rm -rf /root/ca-restore
install -o postgres -g postgres -m 644 /root/ship11-pki-renewed/server.crt /etc/postgresql/17/main/tls/server.crt
install -o postgres -g postgres -m 600 /root/ship11-pki-renewed/server.key /etc/postgresql/17/main/tls/server.key
systemctl reload postgresql@17-main; sleep 2
[ "$(sha256sum /etc/11ship/db-ca.crt | cut -d' ' -f1)" = "$trust_before" ] || die "db-ca.crt changed"
expect_login ship11_app "$secrets/app.pw" /etc/11ship/db-ca.crt "ship11_app tls=t"
ok "leaf renewed under the same CA; unchanged trust store still verifies the server"

step "F3 on the real server: CA rotation: a new CA's certificate is refused until the client trusts that CA"
"$sel/make-pki.sh" new /root/ship11-pki-rotated >/dev/null
old_ca=/etc/11ship/db-ca.crt
cp "$old_ca" /root/old-ca.crt
# switch the server to the NEW CA's certificate while clients still trust only the OLD CA -> must be refused
install -o postgres -g postgres -m 644 /root/ship11-pki-rotated/server.crt /etc/postgresql/17/main/tls/server.crt
install -o postgres -g postgres -m 600 /root/ship11-pki-rotated/server.key /etc/postgresql/17/main/tls/server.key
systemctl reload postgresql@17-main; sleep 2
if login ship11_app "$secrets/app.pw" ship11_staging /root/old-ca.crt >/dev/null 2>&1; then die "a client trusting only the old CA accepted the new CA's certificate"; fi
ok "old trust store refuses the new CA's certificate (verification stays on)"
cat /root/old-ca.crt /root/ship11-pki-rotated/ca.crt > /root/bundle-ca.crt
expect_login ship11_app "$secrets/app.pw" /root/bundle-ca.crt "ship11_app tls=t"
ok "a trust bundle with both CAs accepts the new certificate"
install -m 644 /root/ship11-pki-rotated/ca.crt /etc/11ship/db-ca.crt
expect_login ship11_app "$secrets/app.pw" /etc/11ship/db-ca.crt "ship11_app tls=t"
ok "new CA alone verifies; the old CA is retired"

echo; echo "os-prep: $pass checks passed"
