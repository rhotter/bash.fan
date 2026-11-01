#!/usr/bin/env bash
# Starts the local Docker Postgres and builds the full schema in it.
# Reads DATABASE_URL from the environment, then .env.local, then .env.
set -euo pipefail

read_env_file() {
  grep -hE "^$1=" .env.local .env 2>/dev/null | head -n 1 | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g" || true
}

url="${DATABASE_URL:-$(read_env_file DATABASE_URL)}"

# This script pushes schema changes, so it must never run against a hosted database.
case "$url" in
  *@localhost[:/]* | *@127.0.0.1[:/]*) ;;
  *)
    echo "DATABASE_URL must point at localhost; refusing to continue." >&2
    exit 1
    ;;
esac

database="${url##*/}"
database="${database%%\?*}"

docker compose up -d --wait

DATABASE_URL="$url" npx drizzle-kit push

# Objects drizzle-kit can't create from schema.ts: functions, triggers and the push tables.
cat scripts/operator-security-schema.sql lib/push/schema.sql \
  | docker compose exec -T postgres sh -c \
    'psql -q -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1' _ "$database"

echo "Local database ready: $database"
