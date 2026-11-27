#!/usr/bin/env bash
# Starts the local Docker Postgres and builds the full schema in the database the app would
# use in local dev (see lib/db/resolve-db-url.ts).
set -euo pipefail

# This script pushes schema changes, so this step refuses any database that isn't on localhost.
config="$(npx tsx scripts/local-db-config.ts)"
{ read -r url; read -r database; read -r port; } <<<"$config"

docker compose up -d --wait

# The schema push connects to the URL's port, while psql below runs inside the container.
# Stop unless both reach the same server.
published="$(docker compose port postgres 5432)"
if [[ "${published##*:}" != "$port" ]]; then
  echo "The database URL uses port $port, but the postgres container is published on port ${published##*:}." >&2
  echo "Change the URL, or the port in docker-compose.override.yml, so they match." >&2
  exit 1
fi

run_psql() {
  docker compose exec -T postgres sh -c 'psql -q -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$@"' _ "$@"
}

# The container only creates the default database.
echo "SELECT format('CREATE DATABASE %I', :'name') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'name') \\gexec" \
  | run_psql -d postgres -v name="$database"

# drizzle-kit push exits 0 when it can't connect, a statement fails or a prompt is declined,
# so only its success message shows that the schema is up to date.
push_log="$(mktemp)"
trap 'rm -f "$push_log"' EXIT
DATABASE_URL="$url" npx drizzle-kit push 2>&1 | tee "$push_log"
if ! grep -qE 'Changes applied|No changes detected' "$push_log"; then
  echo "Schema push failed or was aborted, so the local database isn't ready." >&2
  echo "Fix the error above and run pnpm db:setup again, or run pnpm db:reset to start over (deletes local data)." >&2
  exit 1
fi

# Objects drizzle-kit can't create from schema.ts: functions, triggers and the push tables.
# secure-mcp-access.sql starts with role grants that only exist on production, so only
# the part from its trigger function onward is applied.
trigger_sql="$(sed -n '/^CREATE OR REPLACE FUNCTION clear_legacy_game_pin/,$p' scripts/secure-mcp-access.sql)"
if [[ -z "$trigger_sql" ]]; then
  echo "clear_legacy_game_pin not found in scripts/secure-mcp-access.sql" >&2
  exit 1
fi

{
  cat scripts/operator-security-schema.sql lib/push/schema.sql
  echo "$trigger_sql"
} | run_psql -d "$database"

echo "Local database ready: $database"
