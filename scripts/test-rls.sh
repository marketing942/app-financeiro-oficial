#!/usr/bin/env bash
# Runs the RLS security suite against a real local PostgreSQL:
#   1. boots a throwaway cluster;
#   2. applies the Supabase shim (auth schema, roles, auth.uid());
#   3. applies every migration in supabase/migrations/ in order;
#   4. runs the Vitest suite in tests/rls/.
# Also works against Supabase local: set RLS_TEST_DATABASE_URL and it skips
# the local cluster bootstrap.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "${RLS_TEST_DATABASE_URL:-}" ]]; then
  echo "Using existing database: $RLS_TEST_DATABASE_URL"
  npx vitest run --config vitest.rls.config.ts
  exit $?
fi

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORKDIR="${RLS_PG_DIR:-/tmp/dominio-rls-pg}"
PGDATA="$WORKDIR/data"
PORT="${RLS_PG_PORT:-54329}"
DBNAME=dominio_rls_test
DBUSER=postgres

# postgres refuses to run as root: delegate to the postgres system user.
run_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

mkdir -p "$WORKDIR"
if [[ "$(id -u)" == "0" ]]; then
  chown -R postgres:postgres "$WORKDIR"
fi

if [[ ! -d "$PGDATA" ]]; then
  run_pg "$PGBIN/initdb" -D "$PGDATA" -U "$DBUSER" --auth=trust -E UTF8 >/dev/null
fi

run_pg "$PGBIN/pg_ctl" -D "$PGDATA" \
  -o "-p $PORT -k $WORKDIR -c listen_addresses=127.0.0.1" \
  -l "$WORKDIR/pg.log" start >/dev/null

cleanup() {
  run_pg "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
}
trap cleanup EXIT

PSQL=(psql -h 127.0.0.1 -p "$PORT" -U "$DBUSER" -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "drop database if exists $DBNAME" \
  -c "create database $DBNAME" >/dev/null

"${PSQL[@]}" -d "$DBNAME" -f tests/rls/shim.sql >/dev/null

for migration in supabase/migrations/*.sql; do
  echo "applying $migration"
  "${PSQL[@]}" -d "$DBNAME" -f "$migration" >/dev/null
done

if [[ -f supabase/seed.sql ]]; then
  echo "applying supabase/seed.sql"
  "${PSQL[@]}" -d "$DBNAME" -f supabase/seed.sql >/dev/null
fi

export RLS_TEST_DATABASE_URL="postgresql://$DBUSER@127.0.0.1:$PORT/$DBNAME"
npx vitest run --config vitest.rls.config.ts
