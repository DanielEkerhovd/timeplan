#!/usr/bin/env bash
# Kjører migrasjon + sikkerhetstester mot en vanlig Postgres (uten Supabase).
# Bruk: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=timeplan_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/local_stub.sql
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
psql -d "$DB" -f supabase/tests/security.sql 2>&1 | sed -E 's/^psql:[^:]+:[0-9]+: NOTICE:  //'
