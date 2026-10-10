#!/usr/bin/env bash
# Re-runnable DDL verification for the M01-D-ADMIN-1C technical contract. NOT CI; documentation evidence only.
# Needs a PostgreSQL 16 server and a role allowed to CREATE/DROP DATABASE. Connection comes from the standard
# PGHOST / PGPORT / PGUSER / PGPASSWORD variables. Nothing here touches product code or any existing database.
#   PGHOST=/path/to/socket PGPORT=54329 PGUSER=postgres bash docs/verification/m01-d-admin-1c-ddl/run.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
CONTRACT="$ROOT/docs/tasks/M01-D-ADMIN-1C-technical-contract.md"
SUF="$$"; DB1="c1v_${SUF}_a"; DB2="c1v_${SUF}_b"
FAILS=0
psqlq() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB1" -c "DROP DATABASE IF EXISTS $DB2" >/dev/null 2>&1; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; FAILS=$((FAILS+1)); }

# 0. The DDL embedded in the contract must be byte-identical to the files that are executed here.
python3 - "$CONTRACT" "$HERE/sql" <<'PY' || fail "contract embeds DDL that differs from the executed files"
import sys,os
text=open(sys.argv[1]).read()
for f in ["A-up","A-down","B-up","B-down","C-up","C-down"]:
    body=open(os.path.join(sys.argv[2],f+".sql")).read().rstrip()
    if body not in text:
        print("drift:",f); sys.exit(1)
PY

up_repo_migrations() { # $1 = db. Only the "Up Migration" part of every existing migration, in filename order.
  for f in "$ROOT"/database/migrations/*.sql; do
    awk '/^-- Up Migration/{u=1;next} /^-- Down Migration/{u=0} u' "$f" | psqlq -d "$1" || { fail "repo migration $(basename "$f")"; return 1; }
  done
}
up_1c() { for s in A-up B-up C-up; do psqlq -d "$1" -f "$HERE/sql/$s.sql" || fail "$s on $1"; done; }

psql -X -q -d postgres -c "CREATE DATABASE $DB1" -c "CREATE DATABASE $DB2" || { echo "cannot create databases"; exit 2; }

echo "== DB1: Up (repo migrations + 1C A,B,C) and scenarios"
up_repo_migrations "$DB1"; up_1c "$DB1"
OUT="$(psql -X -d "$DB1" -f "$HERE/sql/scenarios.sql" 2>&1)"
PASS=$(printf '%s\n' "$OUT" | grep -c 'NOTICE:  PASS')
NFAIL=$(printf '%s\n' "$OUT" | grep -c 'NOTICE:  FAIL')
printf '%s\n' "$OUT" | grep -E 'NOTICE:  (PASS|FAIL)' | sed 's/^.*NOTICE:  //'
echo "scenarios: PASS=$PASS FAIL=$NFAIL"
[ "$NFAIL" -eq 0 ] && [ "$PASS" -gt 0 ] || fail "scenarios"

echo "== DB1: Down B must refuse while ACTIVATION_* limiter buckets exist"
if psqlq -d "$DB1" -f "$HERE/sql/B-down.sql" >/dev/null 2>&1; then fail "B-down ran with activation buckets present"; else echo "PASS  B-down refused"; fi

echo "== DB2: Up -> Down -> Up"
up_repo_migrations "$DB2"; up_1c "$DB2"
for s in C-down B-down A-down; do psqlq -d "$DB2" -f "$HERE/sql/$s.sql" || fail "$s"; done
LEFT=$(psql -X -At -d "$DB2" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('admin_activation_attempts','admin_activation_otp_challenges','admin_profiles','admin_app_permissions')")
[ "$LEFT" = "0" ] && echo "PASS  Down removed all 1C tables" || fail "Down left $LEFT tables"
up_1c "$DB2"
OUT2="$(psql -X -d "$DB2" -f "$HERE/sql/scenarios.sql" 2>&1)"
P2=$(printf '%s\n' "$OUT2" | grep -c 'NOTICE:  PASS'); F2=$(printf '%s\n' "$OUT2" | grep -c 'NOTICE:  FAIL')
echo "scenarios after Down->Up: PASS=$P2 FAIL=$F2"
[ "$F2" -eq 0 ] && [ "$P2" -eq "$PASS" ] || fail "scenarios after Down->Up"

[ "$FAILS" -eq 0 ] && echo "RESULT: OK" || echo "RESULT: $FAILS FAILURE(S)"
exit "$FAILS"
