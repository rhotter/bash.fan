#!/usr/bin/env bash
# Starts the local Docker Postgres and builds the full schema in it.
# Picks the URL the app would use in local dev (see lib/db/index.ts). Each variable is
# read from the environment, then .env.local, then .env.
set -euo pipefail

read_env_file() {
  grep -hE "^$1=" .env.local .env 2>/dev/null | head -n 1 | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g" || true
}

read_var() {
  local value="${!1:-}"
  echo "${value:-$(read_env_file "$1")}"
}

target="$(read_var DB_TARGET)"
target_var="DATABASE_URL_$(echo "${target:-dev}" | tr '[:lower:]' '[:upper:]')"
url="$(read_var "$target_var")"
url="${url:-$(read_var DATABASE_URL)}"

# This script pushes schema changes, so it must never run against a hosted database.
local_url='^postgres(ql)?://([^@/?#]*@)?(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/([^?#]*))?([?#].*)?$'
if [[ ! "$url" =~ $local_url ]]; then
  echo "$target_var or DATABASE_URL must point at localhost; refusing to continue." >&2
  exit 1
fi

database="${BASH_REMATCH[6]:-postgres}"

docker compose up -d --wait

run_psql() {
  docker compose exec -T postgres sh -c 'psql -q -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$@"' _ "$@"
}

# The container only creates the default database.
echo "SELECT format('CREATE DATABASE %I', :'name') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'name') \\gexec" \
  | run_psql -d postgres -v name="$database"

DATABASE_URL="$url" npx drizzle-kit push

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
