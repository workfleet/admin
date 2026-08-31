#!/usr/bin/env bash
#
# Replays supabase/schema.sql + every migration, in filename order, into an
# empty Postgres. This is the only honest check that the repo can rebuild its
# own database - running the app against the live project proves nothing,
# because the live project has accumulated changes made by hand in the
# dashboard that no file here describes.
#
# Usage:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
#     scripts/replay-schema.sh
#
# Stops at the first statement that errors. A clean run means a brand-new
# Supabase project brought up from these files would have the same shape the
# app expects.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?set DATABASE_URL to an empty throwaway Postgres}"

# ON_ERROR_STOP is the whole point: without it psql reports a failure and
# carries on, and the replay "passes" with half the schema missing.
psql_run() {
  psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --quiet \
    --no-psqlrc \
    --file "$1"
}

echo "==> Supabase stubs (auth, storage, roles)"
psql_run "$ROOT/supabase/ci/prelude.sql"

echo "==> schema.sql"
psql_run "$ROOT/supabase/schema.sql"

echo "==> migrations"
count=0
# Filename order is the apply order, exactly as the README describes and as a
# human running these by hand in the SQL editor would go through them.
for file in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  printf '    %s\n' "$name"
  psql_run "$file"
  count=$((count + 1))
done

echo "==> replayed schema.sql + $count migrations with no errors"
