#!/bin/sh
set -eu
cd /app/apps/server
mkdir -p data uploads
export DATABASE_URL="${DATABASE_URL:-file:/app/apps/server/data/lnkpi.db}"

if [ -f ./node_modules/.bin/prisma ]; then
  ./node_modules/.bin/prisma migrate deploy
elif [ -f /app/node_modules/.bin/prisma ]; then
  /app/node_modules/.bin/prisma migrate deploy
else
  echo "WARN: prisma CLI not found, skipping migrate deploy"
fi

exec node dist/main.js
