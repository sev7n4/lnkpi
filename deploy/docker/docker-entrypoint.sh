#!/bin/sh
set -eu
cd /app/apps/server
mkdir -p data uploads
export DATABASE_URL="${DATABASE_URL:-file:/app/apps/server/data/lnkpi.db}"

PRISMA=""
if [ -f ./node_modules/.bin/prisma ]; then
  PRISMA=./node_modules/.bin/prisma
elif [ -f /app/node_modules/.bin/prisma ]; then
  PRISMA=/app/node_modules/.bin/prisma
fi

MIGRATION_NAME="20260808120000_agent_thread_isolation"
MIGRATION_FILE="prisma/migrations/${MIGRATION_NAME}/migration.sql"
PRISMA_SCHEMA="prisma/schema.prisma"

apply_legacy_migration() {
  echo "Applying ${MIGRATION_NAME} for db-push legacy database"
  if ! "$PRISMA" db execute --file "$MIGRATION_FILE" --schema "$PRISMA_SCHEMA" 2>/tmp/prisma-exec.log; then
    if grep -qiE 'duplicate|already exists|UNIQUE constraint' /tmp/prisma-exec.log; then
      echo "Migration SQL already applied, continuing"
    else
      cat /tmp/prisma-exec.log
      return 1
    fi
  fi
  "$PRISMA" migrate resolve --applied "$MIGRATION_NAME" --schema "$PRISMA_SCHEMA"
}

if [ -n "$PRISMA" ]; then
  if ! "$PRISMA" migrate deploy --schema "$PRISMA_SCHEMA" 2>/tmp/prisma-migrate.log; then
    cat /tmp/prisma-migrate.log
    if grep -q P3005 /tmp/prisma-migrate.log; then
      apply_legacy_migration
      "$PRISMA" migrate deploy --schema "$PRISMA_SCHEMA"
    else
      exit 1
    fi
  fi
else
  echo "WARN: prisma CLI not found, skipping migrate deploy"
fi

exec node dist/main.js
